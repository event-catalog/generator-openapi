import { expect, it, describe, beforeEach, afterEach } from 'vitest';
import utils from '@eventcatalog/sdk';
import plugin from '../index';
import { join } from 'node:path';
import fs from 'fs/promises';
import { vi } from 'vitest';

// Add mock for the local checkLicense module
vi.mock('../utils/checkLicense', () => ({
  default: () => Promise.resolve(),
}));

// Fake eventcatalog config
const config = {};

let catalogDir: string;
const openAPIExamples = join(__dirname, 'openapi-files');

describe('OpenAPI EventCatalog Plugin', () => {
  beforeEach(async () => {
    catalogDir = join(__dirname, 'catalog') || '';
    const exists = await fs
      .access(catalogDir)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      await fs.rm(catalogDir, { recursive: true });
    }
    await fs.mkdir(catalogDir, { recursive: true });
    process.env.PROJECT_DIR = catalogDir;
  });

  afterEach(async () => {
    await fs.rm(join(catalogDir), { recursive: true });
    // hack to wait for async operations to finish in the tests...
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  describe('service generation', () => {
    describe('domains', () => {
      it('if a domain is defined in the OpenAPI plugin configuration and that domain does not exist, it is created', async () => {
        const { getDomain } = utils(catalogDir);

        await plugin(config, {
          services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }],
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
          services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }],
        });
        expect(await getDomain('orders', '1.0.0')).toBeUndefined();
      });

      it('if a domain is defined in the OpenAPI file but the versions do not match, the existing domain is versioned and a new one is created', async () => {
        const { writeDomain, getDomain } = utils(catalogDir);

        await writeDomain({
          id: 'orders',
          name: 'Orders Domain',
          version: '0.0.1',
          markdown: '',
        });

        await plugin(config, {
          services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }],
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
          services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }],
          domain: { id: 'orders', name: 'Orders Domain', version: '1.0.0' },
        });

        const domain = await getDomain('orders', '1.0.0');
        expect(domain.services).toEqual([{ id: 'swagger-petstore', version: '1.0.0' }]);
      });

      it('if multiple OpenAPI files are processed, they are all added to the domain', async () => {
        const { getDomain } = utils(catalogDir);

        await plugin(config, {
          services: [
            { path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' },
            { path: join(openAPIExamples, 'simple.yml'), id: 'simple-api-overview' },
          ],
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

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

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

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

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
            id: 'swagger-petstore-2',
            version: '1.0.0',
            name: 'Random Name',
            markdown: 'Here is my original markdown, please do not override this!',
          },
          { path: 'Swagger Petstore' }
        );

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore-2' }] });

        const service = await getService('swagger-petstore-2', '1.0.0');
        expect(service).toEqual(
          expect.objectContaining({
            id: 'swagger-petstore-2',
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

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

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

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

        const versionedService = await getService('swagger-petstore', '0.0.1');
        const newService = await getService('swagger-petstore', '1.0.0');
        expect(versionedService).toBeDefined();
        expect(newService).toBeDefined();
      });

      it('the openapi file is added to the service which can be downloaded in eventcatalog', async () => {
        const { getService } = utils(catalogDir);
        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service.schemaPath).toEqual('petstore.yml');

        const schema = await fs.readFile(join(catalogDir, 'services', 'swagger-petstore', 'petstore.yml'));
        expect(schema).toBeDefined();
      });

      it('if the openapi file is a URL, the file is downloaded and added to the service', async () => {
        const { getService } = utils(catalogDir);
        await plugin(config, {
          services: [
            {
              path: 'https://raw.githubusercontent.com/event-catalog/generator-openapi/refs/heads/main/examples/petstore/openapi.yml',
              id: 'cart-service',
            },
          ],
        });

        const service = await getService('cart-service', '3.0.0');

        expect(service.schemaPath).toEqual('openapi.yml');

        const schema = await fs.readFile(join(catalogDir, 'services', 'cart-service', 'openapi.yml'));
        expect(schema).toBeDefined();
      });

      it('the original openapi file is added to the service by default instead of parsed version', async () => {
        const { getService } = utils(catalogDir);
        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service.schemaPath).toEqual('petstore.yml');

        const schema = await fs.readFile(join(catalogDir, 'services', 'swagger-petstore', 'petstore.yml'), 'utf8');
        expect(schema).toBeDefined();
      });

      it('the original openapi file is added to the service instead of parsed version', async () => {
        const { getService } = utils(catalogDir);
        await plugin(config, {
          services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }],
          saveParsedSpecFile: false,
        });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service.schemaPath).toEqual('petstore.yml');

        const schema = await fs.readFile(join(catalogDir, 'services', 'swagger-petstore', 'petstore.yml'), 'utf8');
        expect(schema).toBeDefined();
      });

      it('when saveParsedSpecFile is true, the openapi is parsed and refs are resolved', async () => {
        const { getService } = utils(catalogDir);
        await plugin(config, {
          services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }],
          saveParsedSpecFile: true,
        });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service.schemaPath).toEqual('petstore.yml');

        const schema = await fs.readFile(join(catalogDir, 'services', 'swagger-petstore', 'petstore.yml'), 'utf8');
        expect(schema).toBeDefined();
      });

      it('the openapi file is added to the specifications list in eventcatalog', async () => {
        const { getService, writeService } = utils(catalogDir);

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service.specifications?.openapiPath).toEqual('petstore.yml');
      });

      it('if the service already has specifications they are persisted and the openapi one is added on', async () => {
        const { getService, writeService, addFileToService } = utils(catalogDir);

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

        await addFileToService(
          'swagger-petstore',
          {
            fileName: 'asyncapi.yml',
            content: 'Some content',
          },
          '0.0.1'
        );

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service.specifications?.asyncapiPath).toEqual('asyncapi.yml');
        expect(service.specifications?.openapiPath).toEqual('petstore.yml');
      });

      it('if the service already has specifications attached to it, the openapi spec file is added to this list', async () => {
        const { writeService, getService, addFileToService, getSpecificationFilesForService } = utils(catalogDir);

        const existingVersion = '1.0.0';
        await writeService({
          id: 'swagger-petstore',
          version: existingVersion,
          name: 'Random Name',
          markdown: 'Here is my original markdown, please do not override this!',
          specifications: { asyncapiPath: 'simple.asyncapi.yml' },
        });

        await addFileToService(
          'swagger-petstore',
          {
            fileName: 'simple.asyncapi.yml',
            content: 'Some content',
          },
          existingVersion
        );

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

        const service = await getService('swagger-petstore', '1.0.0');
        const specs = await getSpecificationFilesForService('swagger-petstore', existingVersion);

        expect(specs).toHaveLength(2);
        expect(specs[0]).toEqual({
          key: 'openapiPath',
          content: expect.anything(),
          fileName: 'petstore.yml',
          path: expect.anything(),
        });
        expect(specs[1]).toEqual({
          key: 'asyncapiPath',
          content: 'Some content',
          fileName: 'simple.asyncapi.yml',
          path: expect.anything(),
        });

        expect(service.specifications).toEqual({
          openapiPath: 'petstore.yml',
          asyncapiPath: 'simple.asyncapi.yml',
        });
      });

      it('if the service already has specifications attached to it including an AsyncAPI spec file the asyncapi file is overridden', async () => {
        const { writeService, getService, addFileToService, getSpecificationFilesForService } = utils(catalogDir);

        const existingVersion = '1.0.0';
        await writeService({
          id: 'swagger-petstore',
          version: existingVersion,
          name: 'Random Name',
          markdown: 'Here is my original markdown, please do not override this!',
          specifications: { asyncapiPath: 'simple.asyncapi.yml', openapiPath: 'petstore.yml' },
        });

        await addFileToService(
          'swagger-petstore',
          {
            fileName: 'simple.asyncapi.yml',
            content: 'Some content',
          },
          existingVersion
        );
        await addFileToService(
          'swagger-petstore',
          {
            fileName: 'petstore.yml',
            content: 'old contents',
          },
          existingVersion
        );

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

        const service = await getService('swagger-petstore', '1.0.0');
        const specs = await getSpecificationFilesForService('swagger-petstore', existingVersion);

        expect(specs).toHaveLength(2);
        expect(specs[0]).toEqual({
          key: 'openapiPath',
          content: expect.anything(),
          fileName: 'petstore.yml',
          path: expect.anything(),
        });
        expect(specs[1]).toEqual({
          key: 'asyncapiPath',
          content: 'Some content',
          fileName: 'simple.asyncapi.yml',
          path: expect.anything(),
        });

        // Verify that the asyncapi file is overriden content
        expect(specs[0].content).not.toEqual('old contents');

        expect(service.specifications).toEqual({
          openapiPath: 'petstore.yml',
          asyncapiPath: 'simple.asyncapi.yml',
        });
      });

      it('all endpoints in the OpenAPI spec are messages the service receives', async () => {
        const { getService } = utils(catalogDir);

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

        const service = await getService('swagger-petstore', '1.0.0');

        expect(service.receives).toHaveLength(4);
        expect(service.receives).toEqual([
          { id: 'list-pets', version: '1.0.0' },
          { id: 'createPets', version: '1.0.0' },
          { id: 'showPetById', version: '1.0.0' },
          { id: 'petAdopted', version: '1.0.0' },
        ]);
      });

      it('all the endpoints in the OpenAPI spec are messages the service `receives`. If the version matches the latest the receives are persisted', async () => {
        // Create a service with the same name and version as the OpenAPI file for testing
        //sleep
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const { writeService, getService } = utils(catalogDir);

        await writeService(
          {
            id: 'swagger-petstore-3',
            version: '1.0.0',
            name: 'Random Name',
            markdown: 'Here is my original markdown, please do not override this!',
            receives: [{ id: 'userloggedin', version: '1.0.0' }],
          },
          { path: 'Swagger Petstore' }
        );

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore-3' }] });

        const service = await getService('swagger-petstore-3', '1.0.0');
        expect(service.receives).toHaveLength(5);
        expect(service.receives).toEqual([
          { id: 'userloggedin', version: '1.0.0' },
          { id: 'list-pets', version: '1.0.0' },
          { id: 'createPets', version: '1.0.0' },
          { id: 'showPetById', version: '1.0.0' },
          { id: 'petAdopted', version: '1.0.0' },
        ]);
      });

      it('all the endpoints in the OpenAPI spec are messages the service `receives`. If the version matches the latest the receives are persisted, any duplicated are removed', async () => {
        // Create a service with the same name and version as the OpenAPI file for testing
        const { writeService, getService } = utils(catalogDir);

        await writeService(
          {
            id: 'swagger-petstore-5',
            version: '1.0.0',
            name: 'Random Name',
            markdown: 'Here is my original markdown, please do not override this!',
            receives: [
              { id: 'list-pets', version: '1.0.0' },
              { id: 'createPets', version: '1.0.0' },
            ],
          },
          { path: 'Swagger Petstore' }
        );

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore-5' }] });

        const service = await getService('swagger-petstore-5', '1.0.0');
        expect(service.receives).toHaveLength(4);

        expect(service.receives).toEqual([
          { id: 'list-pets', version: '1.0.0' },
          { id: 'createPets', version: '1.0.0' },
          { id: 'showPetById', version: '1.0.0' },
          { id: 'petAdopted', version: '1.0.0' },
        ]);
      });

      describe('service options', () => {
        describe('config option: id', () => {
          it('if an `id` value is given in the service config options, then the generator uses that id and does not generate one from the title', async () => {
            const { getService } = utils(catalogDir);

            await plugin(config, {
              services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore', id: 'my-custom-service-name' }],
            });

            const service = await getService('my-custom-service-name', '1.0.0');

            expect(service).toBeDefined();
          });
        });
      });
    });

    describe('messages', () => {
      it('messages that do not have an `x-eventcatalog-message-type` header defined are documented as queries by default in EventCatalog', async () => {
        const { getQuery } = utils(catalogDir);

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

        const command = await getQuery('list-pets');

        const dir = await fs.readdir(join(catalogDir, 'queries'));

        console.log(dir);

        const file = await fs.readFile(join(catalogDir, 'queries', 'list-pets', 'index.md'));
        expect(file).toBeDefined();

        expect(command).toEqual(
          expect.objectContaining({
            id: 'list-pets',
            version: '1.0.0',
            name: 'List Pets',
            summary: 'List all pets',
            badges: [
              { content: 'GET', textColor: 'blue', backgroundColor: 'blue' },
              { content: 'tag:pets', textColor: 'blue', backgroundColor: 'blue' },
            ],
          })
        );
      });

      describe('OpenAPI eventcatalog extensions', () => {
        it('messages marked as "events" using the custom `x-eventcatalog-message-type` header in an OpenAPI are documented in EventCatalog as events ', async () => {
          const { getEvent } = utils(catalogDir);

          await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

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

        it('messages marked as "commands" using the custom `x-eventcatalog-message-type` header in an OpenAPI are documented in EventCatalog as commands ', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

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

        it('messages marked as "query" using the custom `x-eventcatalog-message-type` header in an OpenAPI are documented in EventCatalog as commands ', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

          const event = await getCommand('showPetById');

          expect(event).toEqual(
            expect.objectContaining({
              id: 'showPetById',
              name: 'showPetById',
              version: '1.0.0',
              summary: 'Info for a specific pet',
            })
          );
        });

        it('messages marked as "sends" using the custom `x-eventcatalog-message-action` header in an OpenAPI are mapped against the service as messages the service sends ', async () => {
          const { getService } = utils(catalogDir);

          await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

          const service = await getService('swagger-petstore');

          expect(service.sends).toHaveLength(1);
          expect(service.sends).toEqual([{ id: 'petVaccinated', version: '1.0.0' }]);
        });

        it('when messages have the `x-eventcatalog-message-name` extension defined, this value is used for the message name', async () => {
          const { getQuery } = utils(catalogDir);

          await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

          const event = await getQuery('list-pets');

          expect(event).toEqual(
            expect.objectContaining({
              id: 'list-pets',
              name: 'List Pets',
              version: '1.0.0',
              summary: 'List all pets',
            })
          );
        });
        it('when messages have the `x-eventcatalog-message-id` extension defined, this value is used for the message id', async () => {
          const { getQuery } = utils(catalogDir);

          await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

          const event = await getQuery('list-pets');
          expect(event.id).toEqual('list-pets');
        });
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

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

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

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

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

        await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

        const command = await getCommand('createPets', '1.0.0');
        expect(command.name).toEqual('createPets');
      });

      it('when the message (operation) does not have a operationId, the path and status code is used to uniquely identify the message', async () => {
        const { getCommand } = utils(catalogDir);

        await plugin(config, { services: [{ path: join(openAPIExamples, 'without-operationIds.yml'), id: 'product-api' }] });

        const getCommandByProductId = await getCommand('product-api_GET_{productId}');
        const getCommandMessage = await getCommand('product-api_GET');

        expect(getCommandByProductId).toBeDefined();
        expect(getCommandMessage).toBeDefined();
      });

      describe('schemas', () => {
        it('when a message has a request body, the request body is the schema of the message', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

          const command = await getCommand('createPets');

          // Can the schema be something else than JSON schema?
          expect(command.schemaPath).toEqual('request-body.json');

          const schema = await fs.readFile(join(catalogDir, 'commands', 'createPets', 'request-body.json'));
          expect(schema).toBeDefined();
        });

        it('when a message has a request body, the markdown contains the request body', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

          const command = await getCommand('createPets');

          expect(command.markdown).toContain(`## Request Body
<SchemaViewer file="request-body.json" maxHeight="500" id="request-body" />`);
        });

        it('when a message has a response, the response is stored as a schema against the message', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

          const command = await getCommand('createPets');

          const schema = await fs.readFile(join(catalogDir, 'commands', 'createPets', 'response-default.json'));
          expect(schema).toBeDefined();
        });

        it('when a message has a response, the response is shown in the markdown file', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

          const command = await getCommand('createPets');

          expect(command.markdown).toContain(`### Responses
**default Response**
<SchemaViewer file="response-default.json" maxHeight="500" id="response-default" />`);
          9;
        });

        it('when a message has parameters they are added to the markdown file when the message is new in the catalog', async () => {
          const { getCommand } = utils(catalogDir);

          await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

          const command = await getCommand('list-pets');

          expect(command.markdown).toContain(`### Parameters
- **limit** (query): How many items to return at one time (max 100)`);
        });
      });
    });

    describe('$ref', () => {
      it('when saveParsedSpecFile is set, the OpenAPI files with $ref are resolved and added to the catalog', async () => {
        const { getService, getCommand } = utils(catalogDir);

        await plugin(config, {
          services: [{ path: join(openAPIExamples, 'ref-example.yml'), id: 'test-service' }],
          saveParsedSpecFile: true,
        });

        const service = await getService('test-service', '1.1.0');
        const event = await getCommand('usersignup', '1.1.0');

        expect(service).toBeDefined();
        expect(event).toBeDefined();
        expect(event.schemaPath).toEqual('request-body.json');
      });

      it('when saveParsedSpecFile is set, the OpenApi saved to the service $ref values are resolved', async () => {
        await plugin(config, {
          services: [{ path: join(openAPIExamples, 'ref-example.yml'), id: 'Test Service' }],
          saveParsedSpecFile: true,
        });

        const asyncAPIFile = (await fs.readFile(join(catalogDir, 'services', 'Test Service', 'ref-example.yml'))).toString();
        const expected = (await fs.readFile(join(openAPIExamples, 'ref-example-with-resolved-refs.yml'))).toString();

        // Normalize line endings
        const normalizeLineEndings = (str: string) => str.replace(/\r\n/g, '\n');

        expect(normalizeLineEndings(asyncAPIFile)).toEqual(normalizeLineEndings(expected));
      });

      it('when saveParsedSpecFile is set, the OpenAPI files with $ref are resolved and added to the catalog', async () => {
        const { getService, getCommand } = utils(catalogDir);

        await plugin(config, {
          services: [{ path: join(openAPIExamples, 'ref-example.json'), id: 'test-service' }],
          saveParsedSpecFile: true,
        });

        const service = await getService('test-service', '1.1.0');
        const event = await getCommand('usersignup', '1.1.0');

        expect(service).toBeDefined();
        expect(event).toBeDefined();
        expect(event.schemaPath).toEqual('request-body.json');
      });

      it('when saveParsedSpecFile is set, the OpenApi has any $ref these are not saved to the service. The servive AsyncAPI is has no $ref', async () => {
        await plugin(config, {
          services: [{ path: join(openAPIExamples, 'ref-example.json'), id: 'Test Service' }],
          saveParsedSpecFile: true,
        });

        const asyncAPIFile = (await fs.readFile(join(catalogDir, 'services', 'Test Service', 'ref-example.json'))).toString();
        const expected = (await fs.readFile(join(openAPIExamples, 'ref-example-with-resolved-refs.json'))).toString();

        // Normalize line endings
        const normalizeLineEndings = (str: string) => str.replace(' ', '').replace(/\r\n/g, '\n').replace(/\s+/g, '');

        expect(normalizeLineEndings(asyncAPIFile)).toEqual(normalizeLineEndings(expected));
      });
    });

    it('when the OpenAPI service is already defined in the EventCatalog and the versions match, the owners and repository are persisted', async () => {
      // Create a service with the same name and version as the OpenAPI file for testing
      const { writeService, getService } = utils(catalogDir);

      await writeService(
        {
          id: 'swagger-petstore',
          version: '1.0.0',
          name: 'Random Name',
          markdown: 'Here is my original markdown, please do not override this!',
          owners: ['dboyne'],
          repository: { language: 'typescript', url: 'https://github.com/dboyne/eventcatalog-plugin-openapi' },
        },
        { path: 'Swagger Petstore' }
      );

      await plugin(config, { services: [{ path: join(openAPIExamples, 'petstore.yml'), id: 'swagger-petstore' }] });

      const service = await getService('swagger-petstore', '1.0.0');
      expect(service).toEqual(
        expect.objectContaining({
          id: 'swagger-petstore',
          name: 'Swagger Petstore',
          version: '1.0.0',
          summary: 'This is a sample server Petstore server.',
          markdown: 'Here is my original markdown, please do not override this!',
          owners: ['dboyne'],
          repository: { language: 'typescript', url: 'https://github.com/dboyne/eventcatalog-plugin-openapi' },
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
  });
});
