import { join } from 'node:path';
import plugin from '../../src/index';

// process.env.PROJECT_DIR = join(__dirname, 'catalog');
process.env.PROJECT_DIR = '/Users/dboyne/Dev/eventcatalog/tmp/open-api-test';

async function main() {
  await plugin(
    {},
    {
      path: join(__dirname, 'openapi.yml'),
      domain: { id: 'stores', name: 'Stores', version: '1.0.0' },
    }
  );
}

main();
