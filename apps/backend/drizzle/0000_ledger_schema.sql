CREATE TABLE "caps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"captured_cents" integer DEFAULT 0 NOT NULL,
	"held_cents" integer DEFAULT 0 NOT NULL,
	"order_id" text,
	"authorization_id" text,
	"authorized_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"reauthorized_at" timestamp with time zone,
	"approve_url" text,
	"return_scenario_id" text,
	"fallback" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caps_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "caps_ledger_check" CHECK ("caps"."captured_cents" >= 0 and "caps"."held_cents" >= 0 and "caps"."captured_cents" + "caps"."held_cents" <= "caps"."amount_cents")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "payment_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cap_id" uuid NOT NULL,
	"purchase_id" uuid,
	"type" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"sentence" text NOT NULL,
	"paypal_call" jsonb,
	"paypal_id" text
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cap_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"product_id" text NOT NULL,
	"domain" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"capture_id" text,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "purchases_run_attempt_key" UNIQUE("run_id","attempt_no")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"scenario_id" text NOT NULL,
	"review" text NOT NULL,
	"status" text NOT NULL,
	"cap_id" uuid NOT NULL,
	"intent" jsonb NOT NULL,
	"checks" jsonb NOT NULL,
	"attempts" jsonb NOT NULL,
	"memory" jsonb NOT NULL,
	"notices" jsonb NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"result" text
);
--> statement-breakpoint
ALTER TABLE "caps" ADD CONSTRAINT "caps_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_cap_id_caps_id_fk" FOREIGN KEY ("cap_id") REFERENCES "public"."caps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_cap_id_caps_id_fk" FOREIGN KEY ("cap_id") REFERENCES "public"."caps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_cap_id_caps_id_fk" FOREIGN KEY ("cap_id") REFERENCES "public"."caps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_one_terminal" ON "payment_events" USING btree ("purchase_id") WHERE "payment_events"."type" in ('captured', 'not_captured');--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_paypal_event_id_key" ON "webhook_events" USING btree ("paypal_event_id");