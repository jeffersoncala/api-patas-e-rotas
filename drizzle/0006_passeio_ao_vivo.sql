ALTER TABLE "contratacoes" ADD COLUMN "iniciado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contratacoes" ADD COLUMN "finalizado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contratacoes" ADD COLUMN "trajeto" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contratacoes" ADD COLUMN "posicao_em" timestamp with time zone;