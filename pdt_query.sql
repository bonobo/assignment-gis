ALTER TABLE planet_osm_roads ADD COLUMN geom geometry;
UPDATE planet_osm_roads set geom=ST_Transform(way, 4326);


SELECT ST_SetSRID(ST_Point(22.301842162688086, 49.10826456556896),4326)

SELECT planet.name, ST_Distance_Spheroid(ST_Centroid(planet.geom), ST_SetSRID(ST_Point(22.400088812720846, 49.07233370715795),4326), 'SPHEROID["WGS 84",6378137,298.257223563]')/1000 as distance 
	FROM planet_osm_point as planet
	WHERE planet.natural LIKE 'peak' and planet.name IS NOT NULL and planet.ele IS NOT NULL
	and ST_Distance_Spheroid(ST_Centroid(planet.geom), ST_SetSRID(ST_Point(22.301842162688086, 49.10826456556896),4326), 'SPHEROID["WGS 84",6378137,298.257223563]') < 10000
	
SELECT point.name, point.ele
	FROM planet_osm_point as point
		LEFT JOIN planet_osm_polygon as polygon ON ST_Contains(polygon.geom, point.geom)
		WHERE polygon.name LIKE 'Národný park Poloniny' AND point.natural LIKE 'peak' AND point.name IS NOT NULL AND point.ele IS NOT NULL

SELECT point.name, point.ele
	FROM planet_osm_point as point
		LEFT JOIN planet_osm_polygon as polygon ON ST_Contains(polygon.geom, point.geom)
		WHERE polygon.boundary = 'national_park' AND point.natural LIKE 'peak' AND point.name IS NOT NULL AND point.ele IS NOT NULL
			AND ST_Distance_Spheroid(ST_Centroid(point.geom), ST_SetSRID(ST_Point(22.301842162688086, 49.10826456556896),4326), 'SPHEROID["WGS 84",6378137,298.257223563]') < 5000
		

select distinct(point.name) from planet_osm_point as point
	join planet_osm_line as line on ST_DWithin(ST_Transform(line.geom, 2163), ST_Transform(point.geom, 2163), 200)
		where line.boundary = 'administrative' and line.admin_level = '2' AND point.natural LIKE 'peak' AND point.name IS NOT NULL AND point.ele IS NOT NULL


CREATE INDEX line_geography ON planet_osm_line USING GIST (ST_Transform(geom, 2163));		
  
 CREATE INDEX planet_line_geom ON planet_osm_line USING GIST(geom)
 CREATE INDEX planet_point_geom ON planet_osm_point USING GIST(geom)
 CREATE INDEX name_ele_point ON planet_osm_point (name, ele)
 CREATE INDEX planet_polygon_geom ON planet_osm_polygon USING GIST(geom)
 CREATE INDEX polygon_boundary ON planet_osm_polygon (boundary)
 CREATE INDEX polygon_name ON planet_osm_polygon (name)
  
  
 SELECT row_to_json(res) FROM (WITH park_areas AS (
	SELECT p.name, ST_Area(p.geom::geography) AS area FROM planet_osm_polygon AS p
		WHERE p.name IN (SELECT DISTINCT(p.name) FROM planet_osm_polygon AS p WHERE p.boundary = 'national_park')
) SELECT park_areas.name, SUM(park_areas.area) 
	FROM park_areas		
	GROUP BY park_areas.name) as res	 


select ST_MakePolygon(ST_MakeLine(sr.geom)) from (SELECT l.geom as geom from planet_osm_line as l where  l.boundary = 'administrative' and l.admin_level = '2' and l.name = 'Slovensko') as sr
