CREATE TYPE "public"."account_type" AS ENUM('talent', 'employer');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_kind" AS ENUM('rewrite', 'extract', 'follow_up', 'summary', 'comparison', 'opportunity_clarify');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_status" AS ENUM('pending', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('submitted', 'in_review', 'shortlisted', 'introduction_requested', 'interviewing', 'offer', 'not_progressing', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('password', 'supabase', 'demo');--> statement-breakpoint
CREATE TYPE "public"."availability_status" AS ENUM('available_now', 'available_from', 'open_to_conversations', 'not_available');--> statement-breakpoint
CREATE TYPE "public"."capability_category" AS ENUM('domain', 'functional', 'technical', 'leadership', 'language');--> statement-breakpoint
CREATE TYPE "public"."capability_tier" AS ENUM('core', 'strong', 'working');--> statement-breakpoint
CREATE TYPE "public"."claim_source" AS ENUM('candidate', 'reference', 'employer', 'platform');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('outcome', 'financial', 'responsibility', 'credential', 'recognition', 'other');--> statement-breakpoint
CREATE TYPE "public"."compensation_period" AS ENUM('annual', 'monthly', 'daily', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."confidentiality" AS ENUM('named', 'anonymised');--> statement-breakpoint
CREATE TYPE "public"."contact_visibility" AS ENUM('private', 'on_introduction', 'approved_employers');--> statement-breakpoint
CREATE TYPE "public"."engagement_kind" AS ENUM('role', 'project', 'venture', 'advisory');--> statement-breakpoint
CREATE TYPE "public"."engagement_stage" AS ENUM('introduction', 'proposal', 'contract_award', 'execution', 'completion');--> statement-breakpoint
CREATE TYPE "public"."engagement_status" AS ENUM('ongoing', 'completed', 'paused', 'discontinued');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('file', 'link', 'reference');--> statement-breakpoint
CREATE TYPE "public"."grant_scope" AS ENUM('contact', 'evidence', 'references');--> statement-breakpoint
CREATE TYPE "public"."grant_source" AS ENUM('application', 'introduction', 'manual');--> statement-breakpoint
CREATE TYPE "public"."introduction_status" AS ENUM('pending', 'accepted', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."item_visibility" AS ENUM('private', 'approved_employers');--> statement-breakpoint
CREATE TYPE "public"."learning_kind" AS ENUM('course', 'certification', 'degree', 'self_directed');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TYPE "public"."opportunity_type" AS ENUM('permanent', 'fixed_term', 'project', 'fractional', 'advisory');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('member', 'admin');--> statement-breakpoint
CREATE TYPE "public"."proficiency" AS ENUM('aware', 'practitioner', 'advanced', 'expert');--> statement-breakpoint
CREATE TYPE "public"."profile_visibility" AS ENUM('private', 'approved_employers');--> statement-breakpoint
CREATE TYPE "public"."public_work_kind" AS ENUM('writing', 'talk', 'podcast', 'open_source', 'community', 'research', 'other');--> statement-breakpoint
CREATE TYPE "public"."relocation" AS ENUM('no', 'open', 'travel_only');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."requirement_importance" AS ENUM('essential', 'desirable');--> statement-breakpoint
CREATE TYPE "public"."requirement_kind" AS ENUM('capability', 'evidence', 'experience', 'language', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."venture_stage" AS ENUM('idea', 'mvp', 'revenue', 'growth', 'exit', 'closed');--> statement-breakpoint
CREATE TYPE "public"."verification_decision" AS ENUM('independently_verified', 'clarification_requested', 'not_verified');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('document_review', 'reference_check', 'public_record', 'issuer_confirmation', 'other');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('self_reported', 'evidence_supplied', 'independently_verified', 'clarification_requested');--> statement-breakpoint
CREATE TYPE "public"."work_arrangement" AS ENUM('remote', 'hybrid', 'on_site');--> statement-breakpoint
CREATE TABLE "access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"scope" "grant_scope" NOT NULL,
	"source" "grant_source" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"error_code" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid,
	"organisation_id" uuid,
	"kind" "ai_suggestion_kind" NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"target_field" text,
	"output" jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"is_demonstration" boolean DEFAULT false NOT NULL,
	"status" "ai_suggestion_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"from_status" "application_status",
	"to_status" "application_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"profile_id" uuid,
	"snapshot_id" uuid,
	"candidate_display_name" text NOT NULL,
	"expression_of_interest" text NOT NULL,
	"status" "application_status" DEFAULT 'submitted' NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"organisation_id" uuid,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category" "capability_category" NOT NULL,
	"curated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"claim_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "claim_evidence_claim_id_evidence_id_pk" PRIMARY KEY("claim_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"engagement_id" uuid,
	"claim_type" "claim_type" DEFAULT 'outcome' NOT NULL,
	"text" text NOT NULL,
	"source" "claim_source" DEFAULT 'candidate' NOT NULL,
	"author_user_id" uuid,
	"author_name" text,
	"achieved_on" date,
	"last_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verification_status" "verification_status" DEFAULT 'self_reported' NOT NULL,
	"verification_requested_at" timestamp with time zone,
	"visibility" "item_visibility" DEFAULT 'approved_employers' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"category" text NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id_hash" text NOT NULL,
	"summary" jsonb NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_capabilities" (
	"engagement_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	CONSTRAINT "engagement_capabilities_engagement_id_capability_id_pk" PRIMARY KEY("engagement_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "engagement_kind" DEFAULT 'project' NOT NULL,
	"title" text NOT NULL,
	"organisation_name" text,
	"confidentiality" "confidentiality" DEFAULT 'named' NOT NULL,
	"anonymised_description" text,
	"role_title" text,
	"sector" text,
	"country" text,
	"start_date" date,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"status" "engagement_status" DEFAULT 'completed' NOT NULL,
	"stage_reached" "engagement_stage",
	"venture_stage" "venture_stage",
	"context" text,
	"responsibility" text,
	"individual_actions" text,
	"team_contribution" text,
	"outcomes" text,
	"lessons" text,
	"team_size" integer,
	"value_currency" text,
	"project_value" numeric(16, 2),
	"revenue_generated" numeric(16, 2),
	"budget_managed" numeric(16, 2),
	"personally_attributable_value" numeric(16, 2),
	"value_notes" text,
	"is_signature" boolean DEFAULT false NOT NULL,
	"visibility" "item_visibility" DEFAULT 'approved_employers' NOT NULL,
	"private_notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "evidence_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text,
	"storage_key" text,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"sha256" text,
	"is_redacted" boolean DEFAULT false NOT NULL,
	"redaction_note" text,
	"reference_id" uuid,
	"derived_text" text,
	"visibility" "item_visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "introduction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"application_id" uuid,
	"requested_by" uuid,
	"message" text NOT NULL,
	"status" "introduction_status" DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "learning_kind" NOT NULL,
	"title" text NOT NULL,
	"provider" text,
	"year" integer,
	"takeaway" text,
	"credential_url" text,
	"verification_status" "verification_status" DEFAULT 'self_reported' NOT NULL,
	"visibility" "item_visibility" DEFAULT 'approved_employers' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"question_key" text NOT NULL,
	"answer" text NOT NULL,
	"visibility" "item_visibility" DEFAULT 'approved_employers' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"title" text NOT NULL,
	"engagement_type" "opportunity_type" NOT NULL,
	"problem_statement" text,
	"expected_outcomes" text,
	"responsibilities" text,
	"experience_requirements" text,
	"required_evidence" text,
	"location_text" text,
	"country" text,
	"work_arrangement" "work_arrangement",
	"time_zone_requirements" text,
	"start_date" date,
	"duration_text" text,
	"hours_per_week" integer,
	"compensation_currency" text,
	"compensation_min" numeric(14, 2),
	"compensation_max" numeric(14, 2),
	"compensation_period" "compensation_period",
	"selection_stages" text[] DEFAULT '{}'::text[] NOT NULL,
	"sectors" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "opportunity_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"kind" "requirement_kind" DEFAULT 'capability' NOT NULL,
	"capability_id" uuid,
	"label" text NOT NULL,
	"importance" "requirement_importance" DEFAULT 'essential' NOT NULL,
	"min_proficiency" "proficiency",
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"country" text,
	"sector" text,
	"size_band" text,
	"description" text,
	"registration_note" text,
	"status" "org_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"capability_id" uuid NOT NULL,
	"tier" "capability_tier" DEFAULT 'strong' NOT NULL,
	"self_proficiency" "proficiency" NOT NULL,
	"assessed_proficiency" "proficiency",
	"assessed_by" uuid,
	"assessed_at" timestamp with time zone,
	"assessment_method" text,
	"years_experience" integer,
	"evidence_note" text,
	"visibility" "item_visibility" DEFAULT 'approved_employers' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"include_contact" boolean DEFAULT false NOT NULL,
	"include_evidence" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "public_work_kind" NOT NULL,
	"title" text NOT NULL,
	"venue" text,
	"url" text,
	"year" integer,
	"description" text,
	"visibility" "item_visibility" DEFAULT 'approved_employers' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"organisation" text,
	"email" text,
	"phone" text,
	"speaks_to" text,
	"engagement_id" uuid,
	"consent_to_contact" boolean DEFAULT false NOT NULL,
	"visibility" "item_visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"include_contact" boolean DEFAULT false NOT NULL,
	"include_evidence" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shortlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shortlist_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"note" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shortlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"preferred_name" text,
	"headline" text,
	"role_family" text,
	"location_city" text,
	"location_country" text,
	"time_zone" text,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"introduction" text,
	"opportunity_types" "opportunity_type"[] DEFAULT '{}' NOT NULL,
	"work_arrangements" "work_arrangement"[] DEFAULT '{}' NOT NULL,
	"relocation" "relocation",
	"geographic_preferences" text,
	"availability_status" "availability_status",
	"available_from" date,
	"notice_period_weeks" integer,
	"hours_per_week" integer,
	"compensation_currency" text,
	"compensation_min" numeric(14, 2),
	"compensation_max" numeric(14, 2),
	"compensation_period" "compensation_period",
	"compensation_visibility" "item_visibility" DEFAULT 'private' NOT NULL,
	"sectors" text[] DEFAULT '{}'::text[] NOT NULL,
	"years_experience" integer,
	"contact_email" text,
	"contact_phone" text,
	"linkedin_url" text,
	"website_url" text,
	"visibility" "profile_visibility" DEFAULT 'private' NOT NULL,
	"contact_visibility" "contact_visibility" DEFAULT 'on_introduction' NOT NULL,
	"evidence_visibility" "item_visibility" DEFAULT 'private' NOT NULL,
	"last_edited_section" text,
	"core_completed_at" timestamp with time zone,
	"last_confirmed_at" timestamp with time zone,
	"search_text" text DEFAULT '' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"auth_provider" "auth_provider" DEFAULT 'password' NOT NULL,
	"external_auth_id" text,
	"account_type" "account_type" NOT NULL,
	"platform_role" "platform_role" DEFAULT 'member' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"reviewer_user_id" uuid,
	"decision" "verification_decision" NOT NULL,
	"method" "verification_method" NOT NULL,
	"scope" text NOT NULL,
	"evidence_ids_reviewed" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"note_to_candidate" text,
	"reason" text NOT NULL,
	"claim_text_at_review" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_snapshot_id_profile_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_evidence_id_evidence_items_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_capabilities" ADD CONSTRAINT "engagement_capabilities_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_capabilities" ADD CONSTRAINT "engagement_capabilities_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introduction_requests" ADD CONSTRAINT "introduction_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introduction_requests" ADD CONSTRAINT "introduction_requests_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introduction_requests" ADD CONSTRAINT "introduction_requests_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introduction_requests" ADD CONSTRAINT "introduction_requests_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introduction_requests" ADD CONSTRAINT "introduction_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_records" ADD CONSTRAINT "learning_records_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_responses" ADD CONSTRAINT "module_responses_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_requirements" ADD CONSTRAINT "opportunity_requirements_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_requirements" ADD CONSTRAINT "opportunity_requirements_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_memberships" ADD CONSTRAINT "organisation_memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_memberships" ADD CONSTRAINT "organisation_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_capabilities" ADD CONSTRAINT "profile_capabilities_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_capabilities" ADD CONSTRAINT "profile_capabilities_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_capabilities" ADD CONSTRAINT "profile_capabilities_assessed_by_users_id_fk" FOREIGN KEY ("assessed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_snapshots" ADD CONSTRAINT "profile_snapshots_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_work_items" ADD CONSTRAINT "public_work_items_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referees" ADD CONSTRAINT "referees_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referees" ADD CONSTRAINT "referees_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_entries" ADD CONSTRAINT "shortlist_entries_shortlist_id_shortlists_id_fk" FOREIGN KEY ("shortlist_id") REFERENCES "public"."shortlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_entries" ADD CONSTRAINT "shortlist_entries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_entries" ADD CONSTRAINT "shortlist_entries_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_entries" ADD CONSTRAINT "shortlist_entries_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD CONSTRAINT "talent_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_reviews" ADD CONSTRAINT "verification_reviews_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_reviews" ADD CONSTRAINT "verification_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_grants_lookup_idx" ON "access_grants" USING btree ("profile_id","organisation_id");--> statement-breakpoint
CREATE INDEX "ai_requests_user_idx" ON "ai_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_suggestions_user_idx" ON "ai_suggestions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "application_events_app_idx" ON "application_events" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_notes_app_idx" ON "application_notes" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "applications_org_idx" ON "applications" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "applications_opp_idx" ON "applications" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "applications_profile_idx" ON "applications" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_unique_active" ON "applications" USING btree ("opportunity_id","profile_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "auth_attempts_key_idx" ON "auth_attempts" USING btree ("key_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_slug_key" ON "capabilities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "claim_evidence_evidence_idx" ON "claim_evidence" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "claims_profile_idx" ON "claims" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "claims_engagement_idx" ON "claims" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "claims_verification_idx" ON "claims" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "content_reports_status_idx" ON "content_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "engagement_capabilities_cap_idx" ON "engagement_capabilities" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "engagements_profile_idx" ON "engagements" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "evidence_profile_idx" ON "evidence_items" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "intro_requests_profile_idx" ON "introduction_requests" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "intro_requests_org_idx" ON "introduction_requests" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "learning_profile_idx" ON "learning_records" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "module_responses_key" ON "module_responses" USING btree ("profile_id","module_key","question_key");--> statement-breakpoint
CREATE INDEX "opportunities_org_idx" ON "opportunities" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "opportunities_status_idx" ON "opportunities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "opp_requirements_opp_idx" ON "opportunity_requirements" USING btree ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_membership_key" ON "organisation_memberships" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE INDEX "org_membership_user_idx" ON "organisation_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organisations_status_idx" ON "organisations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_capabilities_key" ON "profile_capabilities" USING btree ("profile_id","capability_id");--> statement-breakpoint
CREATE INDEX "profile_capabilities_cap_idx" ON "profile_capabilities" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "snapshots_profile_idx" ON "profile_snapshots" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "public_work_profile_idx" ON "public_work_items" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "referees_profile_idx" ON "referees" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_links_profile_idx" ON "share_links" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shortlist_entries_key" ON "shortlist_entries" USING btree ("shortlist_id","profile_id");--> statement-breakpoint
CREATE INDEX "shortlist_entries_profile_idx" ON "shortlist_entries" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "shortlists_org_idx" ON "shortlists" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_profiles_user_key" ON "talent_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "talent_profiles_visibility_idx" ON "talent_profiles" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "talent_profiles_search_idx" ON "talent_profiles" USING gin (to_tsvector('english', "search_text"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_auth_key" ON "users" USING btree ("auth_provider","external_auth_id");--> statement-breakpoint
CREATE INDEX "verification_reviews_claim_idx" ON "verification_reviews" USING btree ("claim_id");