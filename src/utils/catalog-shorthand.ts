/**
 * TODO: Move this into the SDK
 */

import utils from '@eventcatalog/sdk';

export const getMessageTypeUtils = (projectDirectory: string, messageType: string) => {
  const {
    writeEvent,
    versionCommand,
    getEvent,
    getCommand,
    rmCommandById,
    rmEventById,
    writeCommand,
    addFileToCommand,
    addFileToEvent,
    versionEvent,
    versionQuery,
    getQuery,
    rmQueryById,
    writeQuery,
    addFileToQuery,
  } = utils(projectDirectory);

  const messageTypeMap: { [key: string]: any } = {
    event: {
      versionMessage: versionEvent,
      getMessage: getEvent,
      rmMessageById: rmEventById,
      writeMessage: writeEvent,
      addFileToMessage: addFileToEvent,
    },
    command: {
      versionMessage: versionCommand,
      getMessage: getCommand,
      rmMessageById: rmCommandById,
      writeMessage: writeCommand,
      addFileToMessage: addFileToCommand,
    },
    query: {
      versionMessage: versionQuery,
      getMessage: getQuery,
      rmMessageById: rmQueryById,
      writeMessage: writeQuery,
      addFileToMessage: addFileToQuery,
    },
  };

  return messageTypeMap[messageType] || messageTypeMap.query;
};
