const express = require('express');
const router = express.Router();

const named = require('yesql').pg;
const {Pool} = require('pg');

const pool = new Pool({
    user: 'pgdocker',
    host: 'localhost',
    database: 'postgis',
    password: 'pgdocker',
    port: 5432
});

function peaksForLeaflet(withDist, query) {
    if (withDist) {
        return `
    SELECT row_to_json(fc)
      FROM (SELECT 'FeatureCollection' AS type, array_to_json(array_agg(f)) AS features
        FROM (SELECT 'Feature' AS type, ST_AsGeoJSON(p.geom)::json AS geometry, row_to_json((p.name, p.ele, ST_Distance_Spheroid(ST_Centroid(p.geom), ST_SetSRID(ST_Point(:lon, :lat),4326), 'SPHEROID["WGS 84",6378137,298.257223563]'))) AS properties ${query}
        ) AS f
      ) AS fc
    `;
    } else {
        return `
    SELECT row_to_json(fc)
      FROM (SELECT 'FeatureCollection' AS type, array_to_json(array_agg(f)) AS features
        FROM (SELECT 'Feature' AS type, ST_AsGeoJSON(p.geom)::json AS geometry, row_to_json((p.name, p.ele)) AS properties ${query}
        ) AS f
      ) AS fc
    `;
    }
}

const distanceCondition = `AND ST_Distance_Spheroid(ST_Centroid(p.geom), ST_SetSRID(ST_Point(:lon, :lat),4326), 'SPHEROID["WGS 84",6378137,298.257223563]') < :dist`;

function buildQuery(withDist, baseQuery, values = {}) {
    return withDist ? named(peaksForLeaflet(withDist, baseQuery(distanceCondition)))(values) : named(peaksForLeaflet(withDist, baseQuery()))(values);
}

const defaultPeaksQuery = (maybeDist = '') => {
    return `FROM planet_osm_point AS p WHERE p.natural = 'peak' AND p.name IS NOT NULL AND p.ele IS NOT NULL ${maybeDist}`;
};

const peaksInNationalParksQuery = (maybeDist = '') => {
    return `
    FROM planet_osm_point as p
        LEFT JOIN planet_osm_polygon as polygon ON ST_Contains(polygon.geom, p.geom)
	        WHERE polygon.boundary = 'national_park' AND p.natural = 'peak' AND p.name IS NOT NULL AND p.ele IS NOT NULL ${maybeDist}
    `;
};

const peaksInConcreteNationalParksQuery = (maybeDist = '') => {
    return `
    FROM planet_osm_point as p
        LEFT JOIN planet_osm_polygon as polygon ON ST_Contains(polygon.geom, p.geom)
            WHERE polygon.name = ANY(:nat_park) AND p.natural = 'peak' AND p.name IS NOT NULL AND p.ele IS NOT NULL ${maybeDist}
    `;
};

const peaksNearbyBordersQuery = (maybeDist = '') => {
    return `
    FROM (SELECT DISTINCT p.name, p.ele, p.geom
        FROM planet_osm_point AS p
	        LEFT JOIN planet_osm_line AS line ON ST_DWithin(ST_Transform(p.geom, 2163), ST_Transform(line.geom, 2163), 200)
		        WHERE line.boundary = 'administrative' AND line.admin_level = '2' AND p.natural = 'peak' AND p.name IS NOT NULL AND p.ele IS NOT NULL ${maybeDist}) AS p
    `;
};

const peaksNearbyRoadsInNationalParks = (maybeDist = '') => {
    return `
    FROM (
        WITH park_roads AS (
	        SELECT DISTINCT line.geom AS line_geom
	            FROM planet_osm_line AS line 
		            LEFT JOIN planet_osm_polygon AS poly ON ST_Intersects(poly.geom, line.geom)
			            WHERE line.highway = ANY('{primary, secondary, tertiary, road, cycleway}'::text[]) AND poly.boundary = 'national_park'
        ) SELECT DISTINCT p.name, p.ele, p.geom FROM park_roads
	        LEFT JOIN planet_osm_point AS p ON ST_DWithin(ST_Transform(line_geom, 2163), ST_Transform(p.geom, 2163), 2000)
		        WHERE p.natural = 'peak' AND p.name IS NOT NULL AND p.ele IS NOT NULL ${maybeDist}
    ) as p
    `;
};

const nationalParksAreaQuery = {
    text: `
      SELECT row_to_json(res) FROM (
        WITH park_areas AS (SELECT p.name, ST_Area(p.geom::geography) AS area 
          FROM planet_osm_polygon AS p
		    WHERE p.name IN (SELECT DISTINCT(p.name) FROM planet_osm_polygon AS p WHERE p.boundary = 'national_park')
        ) SELECT park_areas.name, ROUND(CAST(float8 (SUM(park_areas.area) / 1000000) AS numeric), 2) AS area
	        FROM park_areas		
	        GROUP BY park_areas.name
	        ORDER BY area DESC) AS res
    `
};

let nationalParksArea = undefined;

function getNationalParksArea() {
    return new Promise(function (resolve) {
        if (!nationalParksArea) {
            pool.query(nationalParksAreaQuery).then(result => {
                let area = [];
                for (key in result.rows) {
                    area.push(result.rows[key].row_to_json);
                }
                nationalParksArea = area;
                resolve(area);
            }).catch(e => setImmediate(() => {
                throw e
            }));
        } else {
            resolve(nationalParksArea);
        }
    });
}

function executeAndRender(res, params, query) {
    getNationalParksArea().then(area => {
        pool.query(query).then(result => {
            res.render('map', {
                title: "PDT | GIS | Mountains",
                jsonData: result.rows[0].row_to_json,
                paramCache: params,
                npArea: area
            });
        }).catch(e => setImmediate(() => {
            throw e
        }));
    });
}

router.get('/map*', function (req, res) {

    let params = req.query;
    console.log('Query params: ', params);

    if (Object.keys(params).length === 0 && params.constructor === Object) {
        executeAndRender(res, params, buildQuery(false, defaultPeaksQuery));
    } else if (params.lat !== '' && params.lon !== '' && params.dist !== '') {
        let lonLatDist = {lon: params.lon, lat: params.lat, dist: params.dist};
        if (params.regions === '' || params.regions === 'all') {
            // kopce v mojom okruku bez ohladu oblasti
            executeAndRender(res, params, buildQuery(true, defaultPeaksQuery, lonLatDist));
        } else if (params.regions === 'national_park') {
            // kopce v mojom okruhu a sucasne nachadzajuce sa v narodnych parkoch
            executeAndRender(res, params, buildQuery(true, peaksInNationalParksQuery, lonLatDist));
        } else if (params.regions === 'park_roads') {
            // kopce v mojom okoli a sucasne nachadzajuce sa v blizkosti ciest v NP
            executeAndRender(res, params, buildQuery(true, peaksNearbyRoadsInNationalParks, lonLatDist));
        } else if (params.regions === 'border') {
            // kopce v mojom okoli a sucasne nachadzajuce sa na hraniciach statov
            executeAndRender(res, params, buildQuery(true, peaksNearbyBordersQuery, lonLatDist));
        } else {
            // kopce v mojom okruhu nachadzajuce sa vo vybranych narodnych parkoch
            executeAndRender(res, params, buildQuery(true, peaksInConcreteNationalParksQuery, Object.assign({}, lonLatDist, {nat_park: params.regions.split(',')})));
        }
    } else if (params.regions === 'national_park') {
        // vsetky kopce nachadzajuce sa v narodnych parkoch
        executeAndRender(res, params, buildQuery(false, peaksInNationalParksQuery));
    } else if (params.regions === 'border') {
        // kopce nachadzajuce sa v blizkosti statnych hranic (do 200m)
        executeAndRender(res, params, buildQuery(false, peaksNearbyBordersQuery));
    } else if (params.regions === 'park_roads') {
        executeAndRender(res, params, buildQuery(false, peaksNearbyRoadsInNationalParks));
    } else if (params.regions !== 'all' && params.regions !== '') {
        // vsetky kopce nachadzajuce vo vybranych narodnych parkoch
        executeAndRender(res, params,
            buildQuery(false, peaksInConcreteNationalParksQuery, {nat_park: params.regions.split(',')})
        );
    } else {
        executeAndRender(res, params, buildQuery(false, defaultPeaksQuery));
    }
});

module.exports = router;
