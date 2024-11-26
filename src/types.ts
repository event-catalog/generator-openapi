import { OpenAPIV3_1 } from 'openapi-types';

export type Domain = {
  id: string;
  name: string;
  version: string;
};

export type Service = {
  id: string;
  path: string;
};

export type Operation = {
  path: string;
  method: string;
  operationId: string;
  summary?: string;
  description?: string;
  type: string;
  action: string;
  externalDocs?: OpenAPIV3_1.ExternalDocumentationObject;
  tags: string[];
  extensions?: {
    [key: string]: any;
  };
};

export interface OpenAPIParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: any;
  description?: string;
}

export interface OpenAPIOperation {
  operationId?: string;
  parameters?: OpenAPIParameter[];
  requestBody?: {
    content?: {
      [contentType: string]: {
        schema: any;
      };
    };
  };
  responses?: {
    [statusCode: string]: {
      isSchema?: boolean;
      content?: {
        [contentType: string]: {
          schema: any;
        };
      };
    };
  };
}

export interface OpenAPIPathItem {
  [method: string]: OpenAPIOperation;
}

export interface OpenAPIPaths {
  [path: string]: OpenAPIPathItem;
}

export interface OpenAPIDocument {
  paths: OpenAPIPaths;
}
