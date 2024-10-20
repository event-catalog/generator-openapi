import utils from '@eventcatalog/sdk';
import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import SwaggerParser from '@apidevtools/swagger-parser';

import { defaultMarkdown as generateMarkdownForDomain } from './utils/domains';
import { buildService } from './utils/services';
import { buildMessage } from './utils/messages';
import { getOperationsByType } from './utils/openapi';
import { Domain, Service } from './types';
import { getMessageTypeUtils } from './utils/catalog-shorthand';
import { OpenAPI } from 'openapi-types';
import checkLicense from './utils/checkLicense';
import yaml from 'js-yaml';
import * as semver from 'semver';

type Props = {
  services: Service[];
  domain?: Domain;
  debug?: boolean;
  saveParsedSpecFile?: boolean;
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
    writeVersionedService,
    addFileToService,
    getSpecificationFilesForService,
  } = utils(process.env.PROJECT_DIR);

  const { services = [], saveParsedSpecFile = false } = options;
  for (const serviceSpec of services) {
    console.log(chalk.green(`Processing ${serviceSpec.path}`));

    try {
      await SwaggerParser.validate(serviceSpec.path);
    } catch (error) {
      console.error(chalk.red(`Failed to parse OpenAPI file: ${serviceSpec.path}`));
      console.error(chalk.red(error));
      continue;
    }

    const document = await SwaggerParser.dereference(serviceSpec.path);
    const version = document.info.version;

    const service = buildService(serviceSpec, document);
    let isOldVersion = false;
    let markdown = service.markdown;
    let specFiles = [];
    let specifications = service.specifications;
    let { sends, receives } = await processMessagesForOpenAPISpec(serviceSpec.path, document);

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

    // Check if service is already defined... if the versions do not match then create service.
    const latestServiceInCatalog = await getService(service.id, 'latest');
    const existingVersionInCatalog = await getService(service.id, version);

    console.log(chalk.blue(`Processing service: ${document.info.title} (v${version})`));

    // Found a service, and versions do not match, we need to version the one already there
    if (latestServiceInCatalog) {
      if (isHigherVersion(version, latestServiceInCatalog.version)) {
        await versionService(service.id);
        console.log(chalk.cyan(` - Versioned previous service (v${latestServiceInCatalog.version})`));
      } else {
        isOldVersion = true;
        console.log(
          chalk.yellow(` - Previous Service (v${version}) detected over newer version ${latestServiceInCatalog.version}...`)
        );
      }
    }

    if (existingVersionInCatalog) {
      markdown = existingVersionInCatalog.markdown;
      specFiles = await getSpecificationFilesForService(service.id, version);
      sends = existingVersionInCatalog.sends || ([] as any);
      receives = [...(existingVersionInCatalog.receives ?? []), ...receives];

      // persist any specifications that are already in the catalog
      specifications = {
        ...specifications,
        ...existingVersionInCatalog.specifications,
      };

      // Match found, override it
      await rmServiceById(service.id, version);
    }

    const choosenWriteServiceAction = isOldVersion ? writeVersionedService : writeService;
    await choosenWriteServiceAction({
      ...service,
      markdown: markdown,
      specifications: specifications,
      sends,
      receives,
    });

    // What files need added to the service (speficiation files)
    const existingSpecFiles = [
      // add any previous spec files to the list
      ...specFiles,
      {
        content: saveParsedSpecFile ? getParsedSpecFile(serviceSpec, document) : await getRawSpecFile(serviceSpec),
        fileName: service.schemaPath,
      },
    ];

    for (const spec of existingSpecFiles) {
      await addFileToService(
        service.id,
        {
          fileName: spec.fileName,
          content: spec.content,
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

const getParsedSpecFile = (service: Service, document: OpenAPI.Document) => {
  const isSpecFileJSON = service.path.endsWith('.json');
  return isSpecFileJSON ? JSON.stringify(document, null, 2) : yaml.dump(document, { noRefs: true });
};

const getRawSpecFile = async (service: Service) => await readFile(service.path, 'utf8');
function isHigherVersion(sourceVersion: string, targetVersion: string) {
  return semver.gt(sourceVersion, targetVersion);
}
