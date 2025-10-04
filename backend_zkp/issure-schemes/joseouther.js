import bs58 from 'bs58';
import { Buffer } from 'buffer';
import {ENVIRONMENT} from '@env';

const testnetConfig = {
  method: 'did:polygonid',
  network: 'polygon',
  subnet: 'amoy', 
  idTypeHex: '0213'
}

const mainnetConfig = {
  method: 'did:polygonid',
  network: 'polygon',
  subnet: 'main', 
  idTypeHex: '0212'
}

export function didFromEthAddress(ethAddress) {
  console.log('Generating DID from EVM address:', ethAddress);
  const config = ENVIRONMENT === 'production' ? mainnetConfig:testnetConfig;

  const addrHex = ethAddress.toLowerCase().replace(/^0x/, '');
  if (addrHex.length !== 40) throw new Error('Dirección EVM inválida');
  const idType = Buffer.from(config.idTypeHex, 'hex');       // 2 bytes (método+red)
  const zeroPad = Buffer.alloc(7, 0);                 // 7 bytes
  const addr    = Buffer.from(addrHex, 'hex');        // 20 bytes
  const body    = Buffer.concat([idType, zeroPad, addr]);

  // checksum uint16 (overflow), little-endian
  const sum = body.reduce((a, b) => (a + b) & 0xffff, 0);
  const checksum = Buffer.from([sum & 0xff, sum >> 8]);

  const idBase58 = bs58.encode(Buffer.concat([body, checksum])); 

  return {
    did: `${config.method}:${config.network}:${config.subnet}:${idBase58}`,
  };
}