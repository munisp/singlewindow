CREATE TABLE "geoip_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip" varchar(45) NOT NULL,
	"country" varchar(64),
	"country_code" varchar(4),
	"city" varchar(128),
	"asn" varchar(32),
	"asn_org" varchar(256),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "geoip_cache_ip_unique" UNIQUE("ip")
);
--> statement-breakpoint
CREATE INDEX "idx_geoip_ip" ON "geoip_cache" USING btree ("ip");--> statement-breakpoint
CREATE INDEX "idx_geoip_country" ON "geoip_cache" USING btree ("country_code");