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

type Props = {
  services: Service[];
  domain?: Domain;
  debug?: boolean;
  saveParsedSpecFile?: boolean;
  licenseKey?: string;
};

export default async (_: any, options: Props) => {
  if (!process.env.PROJECT_DIR) {
    process.env.PROJECT_DIR = process.cwd();
  }

  if (!process.env.PROJECT_DIR) {
    throw new Error('Please provide catalog url (env variable PROJECT_DIR)');
  }

  // Check if the license is valid
  await checkLicense(options.licenseKey);

  const {
    getDomain,
    versionDomain,
    writeDomain,
    addServiceToDomain,
    getService,
    versionService,
    writeService,
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
    let owners = [];
    let repository = null;

    // Check if service is already defined... if the versions do not match then create service.
    const latestServiceInCatalog = await getService(service.id, 'latest');
    console.log(chalk.blue(`Processing service: ${document.info.title} (v${version})`));

    if (latestServiceInCatalog) {
      serviceMarkdown = latestServiceInCatalog.markdown;
      serviceSpecificationsFiles = await getSpecificationFilesForService(service.id, 'latest');
      sends = latestServiceInCatalog.sends || ([] as any);
      owners = latestServiceInCatalog.owners || ([] as any);
      repository = latestServiceInCatalog.repository || null;
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
      }
    }

    await writeService(
      {
        ...service,
        markdown: serviceMarkdown,
        specifications: serviceSpecifications,
        sends,
        receives,
        ...(owners ? { owners } : {}),
        ...(repository ? { repository } : {}),
      },
      { path: service.id, override: true }
    );

    // What files need added to the service (specification files)
    const specFiles = [
      // add any previous spec files to the list
      ...serviceSpecificationsFiles,
      {
        content: saveParsedSpecFile ? getParsedSpecFile(serviceSpec, document) : await getRawSpecFile(serviceSpec),
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
};

const processMessagesForOpenAPISpec = async (pathToSpec: string, document: OpenAPI.Document) => {
  const operations = await getOperationsByType(pathToSpec);
  const version = document.info.version;
  let receives = [],
    sends = [];

  // Go through all messages
  for (const operation of operations) {
    const { requestBodiesAndResponses, ...message } = await buildMessage(pathToSpec, document, operation);
    let messageMarkdown = message.markdown;
    const messageType = operation.type;
    const messageAction = operation.action;

    console.log(chalk.blue(`Processing message: ${message.name} (v${version})`));

    const { addFileToMessage, writeMessage, getMessage, versionMessage } = getMessageTypeUtils(
      process.env.PROJECT_DIR as string,
      messageType
    );

    // Check if the message already exists in the catalog
    const catalogedMessage = await getMessage(message.id, 'latest');

    if (catalogedMessage) {
      messageMarkdown = catalogedMessage.markdown;
      // if the version matches, we can override the message but keep markdown as it  was
      if (catalogedMessage.version !== version) {
        // if the version does not match, we need to version the message
        await versionMessage(message.id);
        console.log(chalk.cyan(` - Versioned previous message: (v${catalogedMessage.version})`));
      }
    }

    // Write the message to the catalog
    await writeMessage({ ...message, markdown: messageMarkdown }, { path: message.id, override: true });

    // If the message send or recieved by the service?
    if (messageAction === 'sends') {
      sends.push({
        id: message.id,
        version: message.version,
      });
    } else {
      receives.push({
        id: message.id,
        version: message.version,
      });
    }

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
  return { receives, sends };
};

const getParsedSpecFile = (service: Service, document: OpenAPI.Document) => {
  const isSpecFileJSON = service.path.endsWith('.json');
  return isSpecFileJSON ? JSON.stringify(document, null, 2) : yaml.dump(document, { noRefs: true });
};

const getRawSpecFile = async (service: Service) => {
  if (service.path.startsWith('http')) {
    const file = await fetch(service.path, { method: 'GET' });
    if (!file.ok) {
      throw new Error(`Failed to fetch file: ${service.path}, status: ${file.status}`);
    }
    return await file.text();
  }
  return await readFile(service.path, 'utf8');
};
