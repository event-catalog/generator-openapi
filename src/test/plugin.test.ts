import { expect, it, describe, beforeEach, afterEach, onTestFailed } from 'vitest';
import utils from '@eventcatalog/sdk';
import plugin from '../index';
import { join } from 'node:path';
import fs from 'fs/promises';
import { send } from 'node:process';

// Fake eventcatalog config
const config = {};

let catalogDir: string;
const openAPIExamples = join(__dirname, 'openapi-files');

describe('OpenAPI EventCatalog Plugin', () => {
  beforeEach(() => {
    catalogDir = join(__dirname, 'catalog') || '';
    fs.mkdir(catalogDir, { recursive: true });
    process.env.PROJECT_DIR = catalogDir;
  });

  afterEach(async () => {
    await fs.rm(join(catalogDir), { recursive: true });
  });

  describe('service generation', () => {
    describe('domains', () => {
      it('if a domain is defined in the OpenAPI plugin configuration and that domain does not exist, it is created', async () => {
        const { getDomain } = utils(catalogDir);

        await plugin(config, {
          path: join(openAPIExamples, 'petstore.yml'),
          domain: { id: 'orders', name: 'Orders Domain', version: '1.0.0' },
        });

        const domain = await getDomain('orders', '1.0.0');

        expect(domain).toEqual(
          expect.objectContaining({
            id: 'orders',
            name: 'Orders Domain',
            version: '1.0.0',
            services: [{ id: 'swagger-petstore', version: '1.0.0' }],
          })
        );
      });

      it('if a domain is not defined in the OpenAPI plugin configuration, the service is not added to any domains', async () => {
        const { getDomain } = utils(catalogDir);
        await plugin(config, {
          path: join(openAPIExamples, 'petstore.yml'),
        });
        expect(await getDomain('orders', '1.0.0')).toBeUndefined();
      });

      it('if a domain is defined in the OpenAPI file but the versions do not match, the existing domain is version and a new one is created', async () => {
        const { writeDomain, getDomain } = utils(catalogDir);

        await writeDomain({
          id: 'orders',
          name: 'Orders Domain',
          version: '0.0.1',
          markdown: '',
        });

        await plugin(config, {
          path: join(openAPIExamples, 'petstore.yml'),
          domain: { id: 'orders', name: 'Orders Domain', version: '1.0.0' },
        });

        const versionedDomain = await getDomain('orders', '0.0.1');
        const newDomain = await getDomain('orders', '1.0.0');

        expect(versionedDomain.version).toEqual('0.0.1');
        expect(newDomain.version).toEqual('1.0.0');
        expect(newDomain.services).toEqual([{ id: 'swagger-petstore', version: '1.0.0' }]);
      });

      it('if a domain is defined in the OpenAPI plugin configuration and that domain exists the OpenAPI Service is added to that domain', async () => {
        const { writeDomain, getDomain } = utils(catalogDir);

        await writeDomain({
          id: 'orders',
          name: 'Orders Domain',
          version: '1.0.0',
          markdown: '',
        });

        await plugin(config, {
          path: join(openAPIExamples, 'petstore.yml'),
          domain: { id: 'orders', name: 'Orders Domain', version: '1.0.0' },
        });

        const domain = await getDomain('orders', '1.0.0');
        expect(domain.services).toEqual([{ id: 'swagger-petstore', version: '1.0.0' }]);
      });

      it('if multiple OpenAPI files are processed, they are all added to the domain', async () => {
        const { getDomain } = utils(catalogDir);

        await plugin(config, {
          path: [join(openAPIExamples, 'petstore.yml'), join(openAPIExamples, 'simple.yml')],
          domain: { id: 'orders', name: 'Orders', version: '1.0.0' },
        });

        const domain = await getDomain('orders', 'latest');

        expect(domain.services).toHaveLength(2);
        expect(domain.services).toEqual([
          { id: 'swagger-petstore', version: '1.0.0' },
          { id: 'simple-api-overview', version: '2.0.0' },
        ]);
      });
    });

    describe('services', () => {
      it('OpenAPI spec is mapped into a service in EventCatalog when no service with this name is already defined', async () => {
        const { getService } = utils(catalogDir);

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const service = await getService('swagger-petstore');

        expect(service).toEqual(
          expect.objectContaining({
            id: 'swagger-petstore',
            name: 'Swagger Petstore',
            version: '1.0.0',
            summary: 'This is a sample server Petstore server.',
            badges: [
              {
                content: 'Pets',
                textColor: 'blue',
                backgroundColor: 'blue',
              },
            ],
          })
        );
      });

      it('when the OpenaPI service is already defined in EventCatalog and the versions match, only metadata is updated', async () => {
        // Create a service with the same name and version as the OpenAPI file for testing
        const { writeService, getService } = utils(catalogDir);

        await writeService(
          {
            id: 'swagger-petstore',
            version: '1.0.0',
            name: 'Random Name',
            markdown: '# Old markdown',
          },
          { path: 'Swagger Petstore' }
        );

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service).toEqual(
          expect.objectContaining({
            id: 'swagger-petstore',
            name: 'Swagger Petstore',
            version: '1.0.0',
            summary: 'This is a sample server Petstore server.',
            markdown: '# Old markdown',
            badges: [
              {
                content: 'Pets',
                textColor: 'blue',
                backgroundColor: 'blue',
              },
            ],
          })
        );
      });

      it('when the OpenAPI service is already defined in EventCatalog and the versions match, the markdown is persisted and not overwritten', async () => {
        // Create a service with the same name and version as the OpenAPI file for testing
        const { writeService, getService } = utils(catalogDir);

        await writeService(
          {
            id: 'swagger-petstore',
            version: '1.0.0',
            name: 'Random Name',
            markdown: 'Here is my original markdown, please do not override this!',
          },
          { path: 'Swagger Petstore' }
        );

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const service = await getService('swagger-petstore', '1.0.0');
        expect(service).toEqual(
          expect.objectContaining({
            id: 'swagger-petstore',
            name: 'Swagger Petstore',
            version: '1.0.0',
            summary: 'This is a sample server Petstore server.',
            markdown: 'Here is my original markdown, please do not override this!',
            badges: [
              {
                content: 'Pets',
                textColor: 'blue',
                backgroundColor: 'blue',
              },
            ],
          })
        );
      });

      it('when the OpenAPI service is already defined in EventCatalog and the versions match, the `sends` list of messages is persisted, as the plugin does not create them', async () => {
        // Create a service with the same name and version as the OpenAPI file for testing
        const { writeService, getService } = utils(catalogDir);

        await writeService(
          {
            id: 'swagger-petstore',
            version: '1.0.0',
            name: 'Random Name',
            markdown: 'Here is my original markdown, please do not override this!',
            sends: [{ id: 'usersignedup', version: '1.0.0' }],
          },
          { path: 'Swagger Petstore' }
        );

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const service = await getService('swagger-petstore', '1.0.0');
        expect(service).toEqual(
          expect.objectContaining({
            sends: [{ id: 'usersignedup', version: '1.0.0' }],
          })
        );
      });

      it('when the OpenAPI service is already defined in EventCatalog and the versions do not match, a new service is created and the old one is versioned', async () => {
        // Create a service with the same name and version as the OpenAPI file for testing
        const { writeService, getService } = utils(catalogDir);

        await writeService(
          {
            id: 'swagger-petstore',
            version: '0.0.1',
            name: 'Swagger Petstore',
            markdown: '',
          },
          { path: 'Swagger Petstore' }
        );

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const versionedService = await getService('swagger-petstore', '0.0.1');
        const newService = await getService('swagger-petstore', '1.0.0');
        expect(versionedService).toBeDefined();
        expect(newService).toBeDefined();
      });

      it('the openapi file is added to the service which can be downloaded in eventcatalog', async () => {
        const { getService } = utils(catalogDir);
        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service.schemaPath).toEqual('petstore.yml');

        const schema = await fs.readFile(join(catalogDir, 'services', 'Swagger Petstore', 'petstore.yml'));
        expect(schema).toBeDefined();
      });

      it('the openapi file is added to the specifications list in eventcatalog', async () => {
        const { getService, writeService } = utils(catalogDir);

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service.specifications?.openapiPath).toEqual('petstore.yml');
      });

      it('if the service already has specifications they are persisted and the openapi one is added on', async () => {
        const { getService, writeService } = utils(catalogDir);
        

        await writeService(
          {
            id: 'swagger-petstore',
            version: '0.0.1',
            name: 'Swagger Petstore',
            specifications: {
              asyncapiPath: 'asyncapi.yml',
            },
            markdown: '',
          },
          { path: 'Swagger Petstore' }
        );

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service.specifications?.asyncapiPath).toEqual('asyncapi.yml');
        expect(service.specifications?.openapiPath).toEqual('petstore.yml');
      });

      it('all endpoints in the OpenAPI spec are messages the service receives', async () => {
        const { getService } = utils(catalogDir);

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service.receives).toHaveLength(4);
        expect(service.receives).toEqual([
          { id: 'listPets', version: '1.0.0' },
          { id: 'createPets', version: '1.0.0' },
          { id: 'showPetById', version: '1.0.0' },
          { id: 'petAdopted', version: '1.0.0' },
        ]);
      });
    });

    describe('messages', () => {
      it('messages that do not have an eventcatalog header are documented as commands by default in EventCatalog', async () => {
        const { getCommand } = utils(catalogDir);

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const command = await getCommand('listPets');

        expect(command).toEqual(
          expect.objectContaining({
            id: 'listPets',
            version: '1.0.0',
            name: 'listPets',
            summary: 'List all pets',
            badges: [
              { content: 'GET', textColor: 'blue', backgroundColor: 'blue' },
              { content: 'tag:pets', textColor: 'blue', backgroundColor: 'blue' },
            ],
          })
        );
      });

      it('messages marked as "events" using the custom `x-ec-message-type` header in an OpenAPI are documented in EventCatalog as events ', async () => {
        const { getEvent } = utils(catalogDir);

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const event = await getEvent('petAdopted');

        expect(event).toEqual(
          expect.objectContaining({
            id: 'petAdopted',
            name: 'petAdopted',
            version: '1.0.0',
            summary: 'Notify that a pet has been adopted',
          })
        );
      });

      it('messages marked as "commands" using the custom `x-ec-message-type` header in an OpenAPI are documented in EventCatalog as commands ', async () => {
        const { getCommand } = utils(catalogDir);

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const event = await getCommand('createPets');

        expect(event).toEqual(
          expect.objectContaining({
            id: 'createPets',
            name: 'createPets',
            version: '1.0.0',
            summary: 'Create a pet',
          })
        );
      });

      it('when the message already exists in EventCatalog but the versions do not match, the existing message is versioned', async () => {
        const { writeCommand, getCommand } = utils(catalogDir);

        await writeCommand({
          id: 'createPets',
          name: 'createPets',
          version: '0.0.1',
          summary: 'Create a pet',
          markdown: '',
        });

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const versionedEvent = await getCommand('createPets', '0.0.1');
        const newEvent = await getCommand('createPets', '1.0.0');

        expect(versionedEvent).toBeDefined();
        expect(newEvent).toBeDefined();
      });

      it('when a the message already exists in EventCatalog the markdown is persisted and not overwritten', async () => {
        const { writeCommand, getCommand } = utils(catalogDir);

        await writeCommand({
          id: 'createPets',
          name: 'createPets',
          version: '0.0.1',
          summary: 'Create a pet',
          markdown: 'please dont override me!',
        });

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const command = await getCommand('createPets', '1.0.0');
        expect(command.markdown).toEqual('please dont override me!');
      });

      it('when a message already exists in EventCatalog with the same version the metadata is updated', async () => {
        const { writeCommand, getCommand } = utils(catalogDir);

        await writeCommand({
          id: 'createPets',
          name: 'Random Name value',
          version: '1.0.0',
          summary: 'Create a pet',
          markdown: '',
        });

        await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

        const command = await getCommand('createPets', '1.0.0');
        expect(command.name).toEqual('createPets');
      });

      it('when the message (operation) does not have a operationId, the path and status code is used to uniquely identify the message', async () => {
        const { getCommand } = utils(catalogDir);

        await plugin(config, { path: join(openAPIExamples, 'without-operationIds.yml') });

        const getCommandByProductId = await getCommand('product-api_GET_{productId}');
        const getCommandMessage = await getCommand('product-api_GET');

        expect(getCommandByProductId).toBeDefined();
        expect(getCommandMessage).toBeDefined();
      });

      describe('schemas', () => {
        it('when a message has a request body, the request body is the schema of the message', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

          const command = await getCommand('createPets');

          // Can the schema be something else than JSON schema?
          expect(command.schemaPath).toEqual('request-body.json');

          const schema = await fs.readFile(join(catalogDir, 'commands', 'createPets', 'request-body.json'));
          expect(schema).toBeDefined();
        });

        it('when a message has a request body, the markdown contains the request body', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

          const command = await getCommand('createPets');

          expect(command.markdown).toContain(`## Request Body
<SchemaViewer file="request-body.json" maxHeight="500" id="request-body" />`);
        });

        it('when a message has a response, the response is stored as a schema against the message', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

          const command = await getCommand('createPets');

          const schema = await fs.readFile(join(catalogDir, 'commands', 'createPets', 'response-default.json'));
          expect(schema).toBeDefined();
        });

        it('when a message has a response, the response is shown in the markdown file', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

          const command = await getCommand('createPets');

          expect(command.markdown).toContain(`### Responses
**default Response**
<SchemaViewer file="response-default.json" maxHeight="500" id="response-default" />`);
          9;
        });

        it('when a message has parameters they are added to the markdown file when the message is new in the catalog', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { path: join(openAPIExamples, 'petstore.yml') });

          const command = await getCommand('listPets');

          expect(command.markdown).toContain(`### Parameters
- **limit** (query): How many items to return at one time (max 100)`);
        });
      });
    });
  });
});
