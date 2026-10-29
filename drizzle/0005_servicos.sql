CREATE TABLE "avaliacoes" (
	"contratacao_id" integer PRIMARY KEY NOT NULL,
	"nota" integer NOT NULL,
	"comentario" text DEFAULT '' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avaliacoes_nota_chk" CHECK ("avaliacoes"."nota" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "avaliacoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contratacao_pets" (
	"contratacao_id" integer NOT NULL,
	"pet_id" integer NOT NULL,
	CONSTRAINT "contratacao_pets_contratacao_id_pet_id_pk" PRIMARY KEY("contratacao_id","pet_id")
);
--> statement-breakpoint
ALTER TABLE "contratacao_pets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contratacoes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contratacoes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"prestador_id" integer NOT NULL,
	"cliente_id" uuid NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fim" timestamp with time zone,
	"contato" text NOT NULL,
	"mensagem" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contratacoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prestador_fotos" (
	"prestador_id" integer NOT NULL,
	"foto_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	CONSTRAINT "prestador_fotos_prestador_id_ordem_pk" PRIMARY KEY("prestador_id","ordem")
);
--> statement-breakpoint
ALTER TABLE "prestador_fotos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prestadores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prestadores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"contato" text NOT NULL,
	"bairro" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"precos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prestadores_usuario_tipo_unq" UNIQUE("usuario_id","tipo")
);
--> statement-breakpoint
ALTER TABLE "prestadores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "avaliacoes" ADD CONSTRAINT "avaliacoes_contratacao_id_contratacoes_id_fk" FOREIGN KEY ("contratacao_id") REFERENCES "public"."contratacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratacao_pets" ADD CONSTRAINT "contratacao_pets_contratacao_id_contratacoes_id_fk" FOREIGN KEY ("contratacao_id") REFERENCES "public"."contratacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratacao_pets" ADD CONSTRAINT "contratacao_pets_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratacoes" ADD CONSTRAINT "contratacoes_prestador_id_prestadores_id_fk" FOREIGN KEY ("prestador_id") REFERENCES "public"."prestadores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratacoes" ADD CONSTRAINT "contratacoes_cliente_id_usuarios_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestador_fotos" ADD CONSTRAINT "prestador_fotos_prestador_id_prestadores_id_fk" FOREIGN KEY ("prestador_id") REFERENCES "public"."prestadores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestador_fotos" ADD CONSTRAINT "prestador_fotos_foto_id_fotos_id_fk" FOREIGN KEY ("foto_id") REFERENCES "public"."fotos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestadores" ADD CONSTRAINT "prestadores_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contratacoes_prestador_idx" ON "contratacoes" USING btree ("prestador_id");--> statement-breakpoint
CREATE INDEX "contratacoes_cliente_idx" ON "contratacoes" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "prestadores_tipo_latitude_idx" ON "prestadores" USING btree ("tipo","latitude");