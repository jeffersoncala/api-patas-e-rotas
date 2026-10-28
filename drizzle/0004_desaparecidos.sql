CREATE TABLE "desaparecidos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "desaparecidos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"especie" text NOT NULL,
	"raca" text DEFAULT '' NOT NULL,
	"porte" text NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"contato" text NOT NULL,
	"foto_id" uuid,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"visto_em" timestamp with time zone NOT NULL,
	"encontrado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desaparecidos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "desaparecidos" ADD CONSTRAINT "desaparecidos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desaparecidos" ADD CONSTRAINT "desaparecidos_foto_id_fotos_id_fk" FOREIGN KEY ("foto_id") REFERENCES "public"."fotos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desaparecidos_latitude_idx" ON "desaparecidos" USING btree ("latitude");--> statement-breakpoint
CREATE INDEX "desaparecidos_usuario_idx" ON "desaparecidos" USING btree ("usuario_id");