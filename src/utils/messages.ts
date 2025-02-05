import { OpenAPI } from 'openapi-types';
import { getSchemasByOperationId } from './openapi';
import { OpenAPIOperation, OpenAPIParameter, Operation } from '../types';
import slugify from 'slugify';

const markdownForParameters = (parameters: OpenAPIParameter[]) => {
  let markdown = '### Parameters\n';

  for (const parameter of parameters) {
    markdown += `- **${parameter.name}** (${parameter.in})`;
    if (parameter.required) {
      markdown += ' (required)';
    }
    if (parameter.description) {
      markdown += `: ${parameter.description}`;
    }
    markdown += '\n';
  }

  return markdown;
};

export const markdownForResponses = (openAPIOperation: OpenAPIOperation) => {
  let markdown = '### Responses\n';

  for (const [statusCode, content] of Object.entries(openAPIOperation.responses as any)) {
    if (content.isSchema) {
      markdown += `**${statusCode} Response**
<SchemaViewer file="response-${statusCode}.json" maxHeight="500" id="response-${statusCode}" />
      `;
    } else {
      markdown += `**${statusCode} Response**
      \`\`\`json
${JSON.stringify(content, null, 2)}
\`\`\`
            `;
    }
  }

  return markdown;
};

export const defaultMarkdown = (message: Operation, openAPIOperation: OpenAPIOperation = {}) => {
  return `


## Architecture
<NodeGraph />

${
  message.description
    ? `
## Overview
${message.description}
`
    : ''
}

${
  message.externalDocs
    ? `
## External documentation
- [${message.externalDocs.description}](${message.externalDocs.url})
`
    : ''
}

## ${message.method.toUpperCase()} \`(${message.path})\`

${openAPIOperation.parameters && openAPIOperation.parameters.length > 0 ? markdownForParameters(openAPIOperation.parameters) : ''}

${
  openAPIOperation.requestBody
    ? `
### Request Body
<SchemaViewer file="request-body.json" maxHeight="500" id="request-body" />
`
    : ''
}

${markdownForResponses(openAPIOperation)}

`;
};

export const getSummary = (message: Operation) => {
  const messageSummary = message.summary ? message.summary : '';
  const messageDescription = message.description ? message.description : '';

  let eventCatalogMessageSummary = messageSummary;

  if (!eventCatalogMessageSummary) {
    eventCatalogMessageSummary = messageDescription && messageDescription.length < 150 ? messageDescription : '';
  }

  return eventCatalogMessageSummary;
};

export const buildMessage = async (pathToFile: string, document: OpenAPI.Document, operation: Operation) => {
  const requestBodiesAndResponses = await getSchemasByOperationId(pathToFile, operation.operationId);
  const extensions = operation.extensions || {};

  const operationTags = operation.tags.map((badge) => ({
    content: `tag:${badge}`,
    textColor: 'blue',
    backgroundColor: 'blue',
  }));

  const badges = [{ content: operation.method.toUpperCase(), textColor: 'blue', backgroundColor: 'blue' }, ...operationTags];

  const apiName = slugify(document.info.title, { lower: true });
  const path = operation.path.replace(/\//, '').replace(/\//g, '_');
  let uniqueIdentifier = operation.operationId || `${apiName}_${operation.method}`;

  if (!operation.operationId && path) {
    uniqueIdentifier = uniqueIdentifier.concat(`_${path}`);
  }

  return {
    id: extensions['x-eventcatalog-message-id'] || uniqueIdentifier,
    version: extensions['x-eventcatalog-message-version'] || document.info.version,
    name: extensions['x-eventcatalog-message-name'] || uniqueIdentifier,
    summary: getSummary(operation),
    markdown: defaultMarkdown(operation, requestBodiesAndResponses),
    schemaPath: requestBodiesAndResponses?.requestBody ? 'request-body.json' : '',
    badges,
    requestBodiesAndResponses,
  };
};
