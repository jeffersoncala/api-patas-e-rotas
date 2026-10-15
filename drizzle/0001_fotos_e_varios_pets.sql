CREATE TABLE "fotos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"dados" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fotos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "passeio_pets" (
	"passeio_id" integer NOT NULL,
	"pet_id" integer NOT NULL,
	CONSTRAINT "passeio_pets_passeio_id_pet_id_pk" PRIMARY KEY("passeio_id","pet_id")
);
--> statement-breakpoint
ALTER TABLE "passeio_pets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pets" DROP CONSTRAINT "pets_usuario_id_unique";--> statement-breakpoint
ALTER TABLE "pets" ADD COLUMN "foto_id" uuid;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "foto_id" uuid;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "meta_semanal_km" double precision DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "fotos" ADD CONSTRAINT "fotos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passeio_pets" ADD CONSTRAINT "passeio_pets_passeio_id_passeios_id_fk" FOREIGN KEY ("passeio_id") REFERENCES "public"."passeios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passeio_pets" ADD CONSTRAINT "passeio_pets_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fotos_usuario_idx" ON "fotos" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "passeio_pets_pet_idx" ON "passeio_pets" USING btree ("pet_id");--> statement-breakpoint
ALTER TABLE "pets" ADD CONSTRAINT "pets_foto_id_fotos_id_fk" FOREIGN KEY ("foto_id") REFERENCES "public"."fotos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_foto_id_fotos_id_fk" FOREIGN KEY ("foto_id") REFERENCES "public"."fotos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pets_usuario_idx" ON "pets" USING btree ("usuario_id");--> statement-breakpoint
-- Dados de antes: a meta semanal era do pet (um por tutor) e passa a ser do tutor.
UPDATE "usuarios" SET "meta_semanal_km" = "pets"."meta_semanal_km" FROM "pets" WHERE "pets"."usuario_id" = "usuarios"."id";--> statement-breakpoint
-- Cada passeio já registrado foi com o único pet do tutor.
INSERT INTO "passeio_pets" ("passeio_id", "pet_id") SELECT "passeios"."id", "pets"."id" FROM "passeios" INNER JOIN "pets" ON "pets"."usuario_id" = "passeios"."usuario_id";
