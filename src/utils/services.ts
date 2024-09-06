import { OpenAPI } from 'openapi-types';
import slugify from 'slugify';

export const defaultMarkdown = (document: OpenAPI.Document, fileName: string) => {
  return `

${document.info.description ? `${document.info.description}` : ''}  

## Architecture diagram
<NodeGraph />

## OpenAPI Specification
<OpenAPI file="${fileName}"/>

${
  document.externalDocs
    ? `
## External documentation
- [${document.externalDocs.description}](${document.externalDocs.url})
`
    : ''
}

`;
};

export const getSummary = (document: OpenAPI.Document) => {
  const summary = document.info.description ? document.info.description : '';
  return summary && summary.length < 150 ? summary : '';
};

export const buildService = (pathToFile: string, document: OpenAPI.Document) => {
  const schemaPath = pathToFile.split('/').pop() || 'openapi.yml';
  const documentTags = document.tags || [];
  return {
    id: slugify(document.info.title, { lower: true, strict: true }),
    version: document.info.version,
    name: document.info.title,
    summary: getSummary(document),
    schemaPath,
    specifications: {
      openapiPath: schemaPath,
    },
    markdown: defaultMarkdown(document, schemaPath),
    badges: documentTags.map((tag) => ({ content: tag.name, textColor: 'blue', backgroundColor: 'blue' })),
  };
};
