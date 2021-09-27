import { serialize, deserialize } from 'borsh';
import { PublicKey } from '@solana/web3.js';

class Assignable {
  constructor(properties) {
      Object.keys(properties).map((key) => {
          this[key] = properties[key];
      });
  }
}

class SetValueInstruction extends Assignable { }

const value = new SetValueInstruction({ key: "test", value: 20 });
const schema = new Map([[SetValueInstruction, { kind: 'struct', fields: [['key', 'string'], ['value', 'u64']] }]]);
const serializedSetValue = serialize(schema, value);


class HAMTSlot extends Assignable { 
  toString() {
    return `value: ${this.value.toString()}, hash: ${new PublicKey(Buffer.from(this.key_hash)).toBase58()}, link: ${new PublicKey(Buffer.from(this.link)).toBase58()}`
  }
}
class HAMTNode extends Assignable { }

const nodeSchema = new Map([
  [HAMTSlot, { kind: 'struct', fields: [['value', 'u64'], ['key_hash', [32]], ['link', [32]]] }],
  [HAMTNode, { kind: 'struct', fields: [['values', [HAMTSlot, 16]]] }]
]);



const s = new HAMTNode({values: Array(16).fill().map((x,i) => new HAMTSlot({
  value: i, 
  key_hash: new Uint8Array(Array(32).fill(i)),
  link: new Uint8Array(Array(32).fill(i)),
}))})


const buffer = serialize(nodeSchema, s);
console.log("Serialized to", buffer.length, " bytes")
const bufferBytes = new Uint8Array(buffer)
const sections = Array(Math.ceil(buffer.length/32)).fill().map((x,i)=>bufferBytes.slice(i*32,(i+1)*32));
const toHex = n => (n < 16 ? '0':'') + n.toString(16)
sections.forEach(section=>console.log(Array.from(section).map(toHex).join(' ')))

const node = deserialize(nodeSchema, HAMTNode, buffer)
console.log("node", node)

const slotData = [
  0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x9f, 0x86, 0xd0, 0x81, 0x88, 0x4c, 0x7d, 0x65, 0x9a, 0x2f,
  0xea, 0xa0, 0xc5, 0x5a, 0xd0, 0x15, 0xa3, 0xbf, 0x4f, 0x1b, 0x2b, 0x0b, 0x82, 0x2c, 0xd1, 0x5d, 0x6c, 0x15,
  0xb0, 0xf0, 0x0a, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]

const node2 = deserialize(nodeSchema, HAMTNode, Buffer.from([16, 0, 0, 0].concat(Array(15*72).fill(0), slotData)))
node2.values.forEach((slot) => console.log(slot.toString()))
