/*!
 * Copyright (c) 2024 Digital Bazaar, Inc. All rights reserved.
 */
import {CborldError} from '../CborldError.js';

export function bytesFromInt({intValue}) {
  let buffer;
  let dataview;
  if(intValue < 256) {
    buffer = new ArrayBuffer(1);
    dataview = new DataView(buffer);
    dataview.setUint8(0, intValue);
  } else if(intValue < 65536) {
    buffer = new ArrayBuffer(2);
    dataview = new DataView(buffer);
    dataview.setUint16(0, intValue);
  } else if(intValue < 4294967296) {
    buffer = new ArrayBuffer(4);
    dataview = new DataView(buffer);
    dataview.setUint32(0, intValue);
  } else {
    throw new CborldError(
      'ERR_COMPRESSION_VALUE_TOO_LARGE',
      `Compression value "${intValue}" too large.`);
  }
  const bytes = new Uint8Array(buffer);
  return bytes;
}

export function intFromBytes({bytes}) {
  const buffer = bytes.buffer;
  const dataview = new DataView(buffer);
  let intValue;
  if(dataview.byteLength === 1) {
    intValue = dataview.getUint8(0);
  } else if(dataview.byteLength === 2) {
    intValue = dataview.getUint16(0);
  } else if(dataview.byteLength === 4) {
    intValue = dataview.getUint32(0);
  } else {
    throw new CborldError(
      'ERR_UNRECOGNIZED_BYTES',
      `Improperly formatted bytes "${bytes}" found.`);
  }
  return intValue;
}