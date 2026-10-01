import { carregarConfig } from '../config.js';
import { abrirBanco } from './cliente.js';

// As migrações também rodam sozinhas ao subir a API; este script serve para aplicá-las
// sem subir o servidor (ex.: no deploy, antes de trocar a versão).
const config = carregarConfig();
abrirBanco(config.arquivoBanco).$client.close();
console.log(`Migrações aplicadas em ${config.arquivoBanco}`);
