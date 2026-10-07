CREATE TYPE "public"."checkout_status" AS ENUM('abandoned', 'recovered', 'used_for_reroute');--> statement-breakpoint
CREATE TYPE "public"."conversion_status" AS ENUM('sent', 'paid', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('open', 'cancelled', 'fulfilled', 'delivered', 'rto', 'rerouted_out');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('cod', 'prepaid', 'partial_cod');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('shopify', 'woocommerce', 'custom');--> statement-breakpoint
CREATE TYPE "public"."reroute_case_status" AS ENUM('evaluating', 'ineligible', 'no_match', 'offered', 'claimed', 'completed', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reroute_offer_status" AS ENUM('sent', 'paid', 'expired', 'superseded', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."risk_action" AS ENUM('allow', 'nudge_prepaid', 'partial_cod', 'verify', 'block_cod');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('created', 'in_transit', 'out_for_delivery', 'ndr', 'rto_initiated', 'rto_delivered', 'delivered', 'rerouted');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('active', 'uninstalled', 'suspended');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"data" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"customer_phone_e164" text,
	"customer_name" text,
	"whatsapp_consent" boolean DEFAULT false NOT NULL,
	"pincode" text,
	"shipping_address" jsonb,
	"lines" jsonb NOT NULL,
	"total_paise" integer NOT NULL,
	"recovery_url" text,
	"status" "checkout_status" DEFAULT 'abandoned' NOT NULL,
	"abandoned_at" timestamp with time zone NOT NULL,
	"last_nudged_at" timestamp with time zone,
	"nudge_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"external_id" text,
	"phone_e164" text,
	"email" text,
	"name" text,
	"whatsapp_consent" boolean DEFAULT false NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"rto_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" text,
	"sku" text,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"order_number" text,
	"customer_id" uuid,
	"payment_mode" "payment_mode" NOT NULL,
	"financial_status" text,
	"status" "order_status" DEFAULT 'open' NOT NULL,
	"total_paise" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"shipping_address" jsonb,
	"shipping_pincode" text,
	"risk_score" integer,
	"risk_action" "risk_action",
	"risk_reasons" jsonb,
	"placed_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pincode_stats" (
	"store_id" uuid NOT NULL,
	"pincode" text NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"rto" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pincode_stats_store_id_pincode_pk" PRIMARY KEY("store_id","pincode")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pincodes" (
	"pincode" text PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"district" text,
	"state" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prepaid_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"risk_score" integer NOT NULL,
	"discount_paise" integer NOT NULL,
	"amount_paise" integer NOT NULL,
	"payment_link_id" text,
	"payment_link_url" text,
	"status" "conversion_status" DEFAULT 'sent' NOT NULL,
	"razorpay_payment_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reroute_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "reroute_case_status" DEFAULT 'evaluating' NOT NULL,
	"reason" text,
	"offer_price_paise" integer,
	"deadline_at" timestamp with time zone,
	"winning_offer_id" uuid,
	"new_order_external_id" text,
	"saved_paise" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reroute_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"checkout_id" uuid,
	"phone_e164" text NOT NULL,
	"distance_km" double precision NOT NULL,
	"score" double precision NOT NULL,
	"price_paise" integer NOT NULL,
	"payment_link_id" text,
	"payment_link_url" text,
	"status" "reroute_offer_status" DEFAULT 'sent' NOT NULL,
	"razorpay_payment_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"courier" text NOT NULL,
	"awb" text NOT NULL,
	"status" "shipment_status" DEFAULT 'created' NOT NULL,
	"ndr_count" integer DEFAULT 0 NOT NULL,
	"last_ndr_reason" text,
	"destination_pincode" text,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"shop_domain" text NOT NULL,
	"name" text,
	"access_token_enc" text,
	"scopes" text,
	"status" "store_status" DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{"codPrepaidEnabled":true,"nudgeThreshold":45,"verifyThreshold":75,"prepaidDiscountPaise":5000,"rerouteEnabled":true,"rerouteDiscountBps":1000,"rerouteMinOrderPaise":30000,"rerouteExcludedSkus":[]}'::jsonb NOT NULL,
	"origin_pincode" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"status" "shipment_status" NOT NULL,
	"raw_status" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"topic" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pincode_stats" ADD CONSTRAINT "pincode_stats_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prepaid_conversions" ADD CONSTRAINT "prepaid_conversions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prepaid_conversions" ADD CONSTRAINT "prepaid_conversions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reroute_cases" ADD CONSTRAINT "reroute_cases_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reroute_cases" ADD CONSTRAINT "reroute_cases_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reroute_cases" ADD CONSTRAINT "reroute_cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reroute_offers" ADD CONSTRAINT "reroute_offers_case_id_reroute_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."reroute_cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reroute_offers" ADD CONSTRAINT "reroute_offers_checkout_id_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkouts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_store_at_idx" ON "audit_log" USING btree ("store_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "checkouts_store_external_uq" ON "checkouts" USING btree ("store_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkouts_store_status_abandoned_idx" ON "checkouts" USING btree ("store_id","status","abandoned_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkouts_lines_gin" ON "checkouts" USING gin ("lines");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customers_store_phone_uq" ON "customers" USING btree ("store_id","phone_e164");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_store_external_idx" ON "customers" USING btree ("store_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_store_variant_idx" ON "order_items" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_store_external_uq" ON "orders" USING btree ("store_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_store_placed_idx" ON "orders" USING btree ("store_id","placed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pincodes_lat_lng_idx" ON "pincodes" USING btree ("lat","lng");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prepaid_conversions_order_uq" ON "prepaid_conversions" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prepaid_conversions_link_uq" ON "prepaid_conversions" USING btree ("payment_link_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reroute_cases_shipment_uq" ON "reroute_cases" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reroute_cases_store_status_idx" ON "reroute_cases" USING btree ("store_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reroute_offers_link_uq" ON "reroute_offers" USING btree ("payment_link_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reroute_offers_case_idx" ON "reroute_offers" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_courier_awb_uq" ON "shipments" USING btree ("courier","awb");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_store_status_idx" ON "shipments" USING btree ("store_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stores_platform_domain_uq" ON "stores" USING btree ("platform","shop_domain");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tracking_events_dedupe_uq" ON "tracking_events" USING btree ("dedupe_key");