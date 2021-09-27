import { sha256 } from "crypto-hash";
import { PublicKey } from "@solana/web3.js";
import { deserialize } from "borsh";
import { HAMTStateSchema, HAMTState, deserializeHAMTNode } from "./serialization.mjs";
import *  as base58 from "bs58";


const BIT_DEPTH = 4;

export const hashPrefix = (idx, hash) => {
  let bitsNeeded = BIT_DEPTH;
  let prefix = 0;

  while (bitsNeeded > 0) {
      let byte = hash[idx >> 3];
      let offset = idx % 8;

      let bits = Math.min(8-offset, bitsNeeded);
      let mask = ((1<<bits) - 1) << offset;
      prefix += ((byte & mask) >> offset) << (BIT_DEPTH - bitsNeeded);
      bitsNeeded -= bits;
      idx += bits;
  }

  return prefix
}

const bufToPublicKey = (buf) => new PublicKey(base58.default.encode(buf))

export const getRoot = async (connection, programStateKey) => {
  const encodedProgramState = (await connection.getAccountInfo(programStateKey, 'singleGossip')).data;
  const decodedProgramState = deserialize(HAMTStateSchema, HAMTState, encodedProgramState);
  const rootKey = bufToPublicKey(decodedProgramState.root_pubkey);
  return rootKey;
}

const nullBuffer = b => b.reduce((isNull, n) => isNull && n === 0, true)
const bufEq = (a,b) => a.length === b.length && a.reduce((m,x,i) => m && x===b[i], true)
const toHex = b => Array.from(b).map(n=>((n<16?'0':'')+n.toString(16))).join(' ')
const countCollisions = (h1, h2, offset) => {
  let collisions = 0;
  for (let bitIdx = offset; bitIdx < 256-BIT_DEPTH && hashPrefix(bitIdx, h1) === hashPrefix(bitIdx, h2); bitIdx += BIT_DEPTH)
    collisions++
  return collisions;
}

const hashBytes = async (str) => {
  const hash = await sha256(str);
  return new Uint8Array(hash.split(/(?=(?:..)*$)/).map(s=>parseInt(s,16)))
}

export const lookup = async (connection, programStateKey, key) => {
  const hash = await hashBytes(key);

  const result = {
    path: [],
    value: undefined,
    collisions: 0,
    hash: toHex(hash),
  }

  let nodeAddr = await getRoot(connection, programStateKey);
  for (let bitIdx = 0; bitIdx < 256-BIT_DEPTH; bitIdx += BIT_DEPTH) {
    result.path.push(nodeAddr)

    const encodedNode = (await connection.getAccountInfo(nodeAddr, 'singleGossip')).data
    const decodedNode = deserializeHAMTNode(encodedNode)
    const prefix = hashPrefix(bitIdx, hash)
    const slot = decodedNode.values[prefix]

    if (nullBuffer(slot.link)) {
      // not link
      if (!nullBuffer(slot.key_hash)) {
        // not empty
        if (bufEq(hash, slot.key_hash)) {
          // found
          result.value = slot.value
        } else {
          // collision
          result.collisions = countCollisions(hash, slot.key_hash, bitIdx)
        }
      }

      // if it's not a link, we're done
      return result
    }

    // linked, check next node
    nodeAddr = bufToPublicKey(slot.link)
  }

  return result
}

export const dumpNode = async (connection, nodeKey) => {
  console.log("\nNode Account:", nodeKey.toBase58())
  const encodedNode = (await connection.getAccountInfo(nodeKey, 'singleGossip')).data;
  const decodedNode = deserializeHAMTNode(encodedNode);
  decodedNode.values.forEach((slot) => console.log(slot.toString()))
}
