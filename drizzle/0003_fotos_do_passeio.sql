CREATE TABLE "passeio_fotos" (
	"passeio_id" integer NOT NULL,
	"foto_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	CONSTRAINT "passeio_fotos_passeio_id_ordem_pk" PRIMARY KEY("passeio_id","ordem")
);
--> statement-breakpoint
ALTER TABLE "passeio_fotos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "passeio_fotos" ADD CONSTRAINT "passeio_fotos_passeio_id_passeios_id_fk" FOREIGN KEY ("passeio_id") REFERENCES "public"."passeios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passeio_fotos" ADD CONSTRAINT "passeio_fotos_foto_id_fotos_id_fk" FOREIGN KEY ("foto_id") REFERENCES "public"."fotos"("id") ON DELETE cascade ON UPDATE no action;