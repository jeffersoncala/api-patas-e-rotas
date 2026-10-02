ALTER TABLE "pets" DROP CONSTRAINT "pets_usuario_id_unique";--> statement-breakpoint
ALTER TABLE "pets" ADD COLUMN "foto_caminho" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "meta_semanal_km" double precision DEFAULT 15 NOT NULL;--> statement-breakpoint
CREATE INDEX "pets_usuario_idx" ON "pets" USING btree ("usuario_id");--> statement-breakpoint
-- A meta saiu do pet e foi para o tutor: cada conta tinha um pet só, então leva a dele.
UPDATE "usuarios" SET "meta_semanal_km" = "pets"."meta_semanal_km" FROM "pets" WHERE "pets"."usuario_id" = "usuarios"."id";
