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
  } = utils(projectDirectory);

  if (messageType === 'event') {
    return {
      versionMessage: versionEvent,
      getMessage: getEvent,
      rmMessageById: rmEventById,
      writeMessage: writeEvent,
      addFileToMessage: addFileToEvent,
    };
  }

  // default command
  return {
    versionMessage: versionCommand,
    getMessage: getCommand,
    rmMessageById: rmCommandById,
    writeMessage: writeCommand,
    addFileToMessage: addFileToCommand,
  };
};
