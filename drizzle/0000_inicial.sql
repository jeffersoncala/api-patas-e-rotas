CREATE TABLE "curtidas" (
	"passeio_id" integer NOT NULL,
	"usuario_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curtidas_passeio_id_usuario_id_pk" PRIMARY KEY("passeio_id","usuario_id")
);
--> statement-breakpoint
ALTER TABLE "curtidas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "encontros" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "encontros_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organizador_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"local" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"data" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "encontros" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "favoritas" (
	"rota_id" integer NOT NULL,
	"usuario_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favoritas_rota_id_usuario_id_pk" PRIMARY KEY("rota_id","usuario_id")
);
--> statement-breakpoint
ALTER TABLE "favoritas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "passeios" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "passeios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario_id" uuid NOT NULL,
	"rota_id" integer,
	"rota_nome" text DEFAULT '' NOT NULL,
	"pontos" jsonb NOT NULL,
	"distancia_km" double precision NOT NULL,
	"duracao_min" integer NOT NULL,
	"texto" text DEFAULT '' NOT NULL,
	"data" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "passeios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"especie" text NOT NULL,
	"raca" text DEFAULT '' NOT NULL,
	"idade_anos" integer DEFAULT 1 NOT NULL,
	"porte" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"meta_semanal_km" double precision DEFAULT 15 NOT NULL,
	CONSTRAINT "pets_usuario_id_unique" UNIQUE("usuario_id")
);
--> statement-breakpoint
ALTER TABLE "pets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "presencas" (
	"encontro_id" integer NOT NULL,
	"usuario_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presencas_encontro_id_usuario_id_pk" PRIMARY KEY("encontro_id","usuario_id")
);
--> statement-breakpoint
ALTER TABLE "presencas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "redefinicoes_senha" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "redefinicoes_senha_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usada_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redefinicoes_senha_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "redefinicoes_senha" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rotas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rotas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"autor_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"bairro" text NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"pontos" jsonb NOT NULL,
	"distancia_km" double precision NOT NULL,
	"duracao_min" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rotas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"refresh_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"revogada_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessoes_refresh_hash_unique" UNIQUE("refresh_hash")
);
--> statement-breakpoint
ALTER TABLE "sessoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"tutor" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_acesso_em" timestamp with time zone,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "usuarios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "curtidas" ADD CONSTRAINT "curtidas_passeio_id_passeios_id_fk" FOREIGN KEY ("passeio_id") REFERENCES "public"."passeios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curtidas" ADD CONSTRAINT "curtidas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encontros" ADD CONSTRAINT "encontros_organizador_id_usuarios_id_fk" FOREIGN KEY ("organizador_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favoritas" ADD CONSTRAINT "favoritas_rota_id_rotas_id_fk" FOREIGN KEY ("rota_id") REFERENCES "public"."rotas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favoritas" ADD CONSTRAINT "favoritas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passeios" ADD CONSTRAINT "passeios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passeios" ADD CONSTRAINT "passeios_rota_id_rotas_id_fk" FOREIGN KEY ("rota_id") REFERENCES "public"."rotas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pets" ADD CONSTRAINT "pets_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_encontro_id_encontros_id_fk" FOREIGN KEY ("encontro_id") REFERENCES "public"."encontros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redefinicoes_senha" ADD CONSTRAINT "redefinicoes_senha_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotas" ADD CONSTRAINT "rotas_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "encontros_data_idx" ON "encontros" USING btree ("data");--> statement-breakpoint
CREATE INDEX "passeios_data_idx" ON "passeios" USING btree ("data");--> statement-breakpoint
CREATE INDEX "passeios_usuario_idx" ON "passeios" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "passeios_rota_idx" ON "passeios" USING btree ("rota_id");--> statement-breakpoint
CREATE INDEX "sessoes_usuario_idx" ON "sessoes" USING btree ("usuario_id");