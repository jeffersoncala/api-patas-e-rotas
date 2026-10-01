CREATE TABLE `curtidas` (
	`passeio_id` integer NOT NULL,
	`usuario_id` text NOT NULL,
	`criado_em` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`passeio_id`, `usuario_id`),
	FOREIGN KEY (`passeio_id`) REFERENCES `passeios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `encontros` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organizador_id` text NOT NULL,
	`titulo` text NOT NULL,
	`descricao` text DEFAULT '' NOT NULL,
	`local` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`data` integer NOT NULL,
	`criado_em` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`organizador_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `encontros_data_idx` ON `encontros` (`data`);--> statement-breakpoint
CREATE TABLE `favoritas` (
	`rota_id` integer NOT NULL,
	`usuario_id` text NOT NULL,
	`criado_em` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`rota_id`, `usuario_id`),
	FOREIGN KEY (`rota_id`) REFERENCES `rotas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `passeios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` text NOT NULL,
	`rota_id` integer,
	`rota_nome` text DEFAULT '' NOT NULL,
	`pontos` text NOT NULL,
	`distancia_km` real NOT NULL,
	`duracao_min` integer NOT NULL,
	`texto` text DEFAULT '' NOT NULL,
	`data` integer NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rota_id`) REFERENCES `rotas`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `passeios_data_idx` ON `passeios` (`data`);--> statement-breakpoint
CREATE INDEX `passeios_usuario_idx` ON `passeios` (`usuario_id`);--> statement-breakpoint
CREATE INDEX `passeios_rota_idx` ON `passeios` (`rota_id`);--> statement-breakpoint
CREATE TABLE `pets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` text NOT NULL,
	`nome` text NOT NULL,
	`especie` text NOT NULL,
	`raca` text DEFAULT '' NOT NULL,
	`idade_anos` integer DEFAULT 1 NOT NULL,
	`porte` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`meta_semanal_km` real DEFAULT 15 NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pets_usuario_id_unique` ON `pets` (`usuario_id`);--> statement-breakpoint
CREATE TABLE `presencas` (
	`encontro_id` integer NOT NULL,
	`usuario_id` text NOT NULL,
	`criado_em` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`encontro_id`, `usuario_id`),
	FOREIGN KEY (`encontro_id`) REFERENCES `encontros`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `redefinicoes_senha` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expira_em` integer NOT NULL,
	`usada_em` integer,
	`criado_em` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `redefinicoes_senha_token_hash_unique` ON `redefinicoes_senha` (`token_hash`);--> statement-breakpoint
CREATE TABLE `rotas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`autor_id` text NOT NULL,
	`nome` text NOT NULL,
	`bairro` text NOT NULL,
	`descricao` text DEFAULT '' NOT NULL,
	`pontos` text NOT NULL,
	`distancia_km` real NOT NULL,
	`duracao_min` integer NOT NULL,
	`criado_em` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`autor_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessoes` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` text NOT NULL,
	`refresh_hash` text NOT NULL,
	`expira_em` integer NOT NULL,
	`revogada_em` integer,
	`criado_em` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessoes_refresh_hash_unique` ON `sessoes` (`refresh_hash`);--> statement-breakpoint
CREATE INDEX `sessoes_usuario_idx` ON `sessoes` (`usuario_id`);--> statement-breakpoint
CREATE TABLE `usuarios` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`senha_hash` text NOT NULL,
	`tutor` text NOT NULL,
	`criado_em` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`ultimo_acesso_em` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuarios_email_unique` ON `usuarios` (`email`);