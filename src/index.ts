import utils from '@eventcatalog/sdk';
import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import SwaggerParser from '@apidevtools/swagger-parser';

import { defaultMarkdown as generateMarkdownForDomain } from './utils/domains';
import { buildService } from './utils/services';
import { buildMessage } from './utils/messages';
import { getOperationsByType } from './utils/openapi';
import { getMessageTypeUtils } from './utils/catalog-shorthand';
import { OpenAPI } from 'openapi-types';
import checkLicense from './utils/checkLicense';
import { z } from 'zod';

const optionsSchema = z.object({
  services: z.array(
    z.object({
      id: z.string({ required_error: 'The service id is required. please provide the service id' }),
      path: z.string({ required_error: 'The service path is required. please provide the path to specification file' }),
      name: z.string().optional(),
    }),
    { message: 'Please provide correct services configuration' }
  ),
  domain: z
    .object({
      id: z.string({ required_error: 'The domain id is required. please provide a domain id' }),
      name: z.string({ required_error: 'The domain name is required. please provide a domain name' }),
      version: z.string({ required_error: 'The domain version is required. please provide a domain version' }),
    })
    .optional(),
  debug: z.boolean().optional(),
  saveParsedSpecFile: z.boolean({ invalid_type_error: 'The saveParsedSpecFile is not a boolean in options' }).optional(),
});

type Props = z.infer<typeof optionsSchema>;

const validateOptions = (options: Props) => {
  try {
    optionsSchema.parse(options);
  } catch (error: any) {
    if (error instanceof z.ZodError) throw new Error(JSON.stringify(error.issues, null, 2));
  }
};
export default async (_: any, options: Props) => {
  if (!process.env.PROJECT_DIR) {
    throw new Error('Please provide catalog url (env variable PROJECT_DIR)');
  }

  const {
    getDomain,
    versionDomain,
    writeDomain,
    addServiceToDomain,
    getService,
    versionService,
    rmServiceById,
    writeService,
    addFileToService,
    getSpecificationFilesForService,
  } = utils(process.env.PROJECT_DIR);

  const services = options.services ?? [];
  validateOptions(options);
  for (const serviceSpec of services) {
    console.log(chalk.green(`Processing ${serviceSpec.path}`));

    try {
      await SwaggerParser.validate(serviceSpec.path);
    } catch (error) {
      console.error(chalk.red(`Failed to parse OpenAPI file: ${serviceSpec.path}`));
      console.error(chalk.red(error));
      continue;
    }

    const openAPIFile = await readFile(serviceSpec.path, 'utf-8');
    const document = await SwaggerParser.parse(serviceSpec.path);
    const version = document.info.version;

    const service = buildService(serviceSpec, document);
    let serviceMarkdown = service.markdown;
    let serviceSpecificationsFiles = [];
    let serviceSpecifications = service.specifications;

    // Manage domain
    if (options.domain) {
      // Try and get the domain
      const { id: domainId, name: domainName, version: domainVersion } = options.domain;
      const domain = await getDomain(options.domain.id, domainVersion || 'latest');
      const currentDomain = await getDomain(options.domain.id, 'latest');

      console.log(chalk.blue(`\nProcessing domain: ${domainName} (v${domainVersion})`));

      // Found a domain, but the versions do not match
      if (currentDomain && currentDomain.version !== domainVersion) {
        await versionDomain(domainId);
        console.log(chalk.cyan(` - Versioned previous domain (v${currentDomain.version})`));
      }

      // Do we need to create a new domain?
      if (!domain || (domain && domain.version !== domainVersion)) {
        await writeDomain({
          id: domainId,
          name: domainName,
          version: domainVersion,
          markdown: generateMarkdownForDomain(),
        });
        console.log(chalk.cyan(` - Domain (v${domainVersion}) created`));
      }

      if (currentDomain && currentDomain.version === domainVersion) {
        console.log(chalk.yellow(` - Domain (v${domainVersion}) already exists, skipped creation...`));
      }

      // Add the service to the domain
      await addServiceToDomain(domainId, { id: service.id, version: service.version }, domainVersion);
    }

    // Process all messages for the OpenAPI spec
    let { sends, receives } = await processMessagesForOpenAPISpec(serviceSpec.path, document);

    // Check if service is already defined... if the versions do not match then create service.
    const latestServiceInCatalog = await getService(service.id, 'latest');
    console.log(chalk.blue(`Processing service: ${document.info.title} (v${version})`));

    if (latestServiceInCatalog) {
      serviceMarkdown = latestServiceInCatalog.markdown;
      serviceSpecificationsFiles = await getSpecificationFilesForService(service.id, 'latest');
      sends = latestServiceInCatalog.sends || ([] as any);

      // persist any specifications that are already in the catalog
      serviceSpecifications = {
        ...serviceSpecifications,
        ...latestServiceInCatalog.specifications,
      };

      // Found a service, and versions do not match, we need to version the one already there
      if (latestServiceInCatalog.version !== version) {
        await versionService(service.id);
        console.log(chalk.cyan(` - Versioned previous service (v${latestServiceInCatalog.version})`));
      }

      // Match found, override it
      if (latestServiceInCatalog.version === version) {
        receives = latestServiceInCatalog.receives ? [...latestServiceInCatalog.receives, ...receives] : receives;
        await rmServiceById(service.id);
      }
    }

    await writeService(
      {
        ...service,
        markdown: serviceMarkdown,
        specifications: serviceSpecifications,
        sends,
        receives,
      },
      { path: service.id }
    );

    // What files need added to the service (speficiation files)
    const specFiles = [
      // add any previous spec files to the list
      ...serviceSpecificationsFiles,
      {
        content: openAPIFile,
        fileName: service.schemaPath,
      },
    ];

    for (const specFile of specFiles) {
      await addFileToService(
        service.id,
        {
          fileName: specFile.fileName,
          content: specFile.content,
        },
        version
      );
    }

    console.log(chalk.cyan(` - Service (v${version}) created`));
  }

  await checkLicense();
};

const processMessagesForOpenAPISpec = async (pathToSpec: string, document: OpenAPI.Document) => {
  const operations = await getOperationsByType(pathToSpec);
  const version = document.info.version;
  let receives = [];

  // Go through all messages
  for (const operation of operations) {
    const { requestBodiesAndResponses, ...message } = await buildMessage(pathToSpec, document, operation);
    let messageMarkdown = message.markdown;
    const messageType = operation.type;

    console.log(chalk.blue(`Processing message: ${message.name} (v${version})`));

    const { addFileToMessage, writeMessage, rmMessageById, getMessage, versionMessage } = getMessageTypeUtils(
      process.env.PROJECT_DIR as string,
      messageType
    );

    // Check if the message already exists in the catalog
    const catalogedMessage = await getMessage(message.id, 'latest');

    if (catalogedMessage) {
      messageMarkdown = catalogedMessage.markdown;
      // if the version matches, we can override the message but keep markdown as it  was
      if (catalogedMessage.version === version) {
        await rmMessageById(message.id, version);
      } else {
        // if the version does not match, we need to version the message
        await versionMessage(message.id);
        console.log(chalk.cyan(` - Versioned previous message: (v${catalogedMessage.version})`));
      }
    }

    // Write the message to the catalog
    await writeMessage({ ...message, markdown: messageMarkdown }, { path: message.name });

    // messages will always be messages the service receives
    receives.push({
      id: message.id,
      version: message.version,
    });

    // Does the message have a request body or responses?
    if (requestBodiesAndResponses?.requestBody) {
      await addFileToMessage(
        message.id,
        {
          fileName: 'request-body.json',
          content: JSON.stringify(requestBodiesAndResponses.requestBody, null, 2),
        },
        message.version
      );
    }

    if (requestBodiesAndResponses?.responses) {
      for (const [statusCode, schema] of Object.entries(requestBodiesAndResponses.responses)) {
        await addFileToMessage(
          message.id,
          {
            fileName: `response-${statusCode}.json`,
            content: JSON.stringify(schema, null, 2),
          },
          message.version
        );
      }
    }

    console.log(chalk.cyan(` - Message (v${version}) created`));
    if (!operation.operationId) {
      console.log(chalk.yellow(`  - OperationId not found for ${operation.method} ${operation.path}, creating one...`));
      console.log(chalk.yellow(`  - Use operationIds to give better unique names for EventCatalog`));
    }
  }
  return { receives, sends: [] };
};
