
import { Account, Connection, PublicKey, SystemProgram, TransactionInstruction, Transaction, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { deserializeHAMTNode, serializeSetValueInstruction, HAMTStateSize, HAMTNodeSize } from "./serialization.mjs";
import { Command } from "commander";
import { getRoot, dumpNode, lookup } from "./hamt.mjs";

const signerAccount = new Account(new Uint8Array([46,139,140,139,17,3,211,126,63,25,51,125,199,143,156,254,123,246,90,109,95,190,202,71,244,236,69,47,101,37,153,193,38,208,13,251,62,220,212,80,139,6,146,11,249,66,25,204,185,216,43,115,35,158,33,82,246,36,144,88,255,124,243,144]));
const programID = new PublicKey("Dqbmj4xvKZENKwNX8BwdbcCLeNVRojUCe2GWmEDnGjj6");
const connection = new Connection("http://localhost:8899", 'singleGossip');

/**
 * Init HAMT
 * Initialize a new HAMT with a program state account and root node.
 * Outputs the HAMT address which identified the HAMT instance for future calls.
 */
const initHAMT = async () => {
  const stateAccount = new Account();
  const createProgramAccountIx = SystemProgram.createAccount({
    space: HAMTStateSize,
    lamports: await connection.getMinimumBalanceForRentExemption(HAMTStateSize, 'singleGossip'),
    fromPubkey: signerAccount.publicKey,
    newAccountPubkey: stateAccount.publicKey,
    programId: programID
  });
  
  const rootAccount = new Account();
  const createRootAccountIx = SystemProgram.createAccount({
    space: HAMTNodeSize,
    lamports: await connection.getMinimumBalanceForRentExemption(HAMTNodeSize, 'singleGossip'),
    fromPubkey: signerAccount.publicKey,
    newAccountPubkey: rootAccount.publicKey,
    programId: programID
  });

  const initIx = new TransactionInstruction({
    programId: programID,
    keys: [
        { pubkey: signerAccount.publicKey, isSigner: true, isWritable: false },
        { pubkey: stateAccount.publicKey, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
        { pubkey: rootAccount.publicKey, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([0]),
  })
  
  const tx = new Transaction().add(createProgramAccountIx, createRootAccountIx, initIx);
  let str = await connection.sendTransaction(tx, [signerAccount, stateAccount, rootAccount], {skipPreflight: false, preflightCommitment: 'singleGossip'});

  console.log("HAMT Address:", stateAccount.publicKey.toBase58());
  console.log("Root Address:", rootAccount.publicKey.toBase58());
  process.exit(0)
}

/**
 * Set Value
 * @param hamt address of hamt program state
 * @param key string key to store
 * @param value numeric value to store
 */
const setValue = async (hamt, key, value) => {
  let txSig = await _setValue(new PublicKey(hamt), key, value)
  
  console.log("Transaction:", txSig)  

  await connection.confirmTransaction(txSig)
  const result = await connection.getTransaction(txSig, {commitment: 'confirmed'})
  console.log(result.txSignature)

  // for await (let nodeKey of fullPath) await dumpNode(connection, nodeKey);

  process.exit(0);
}

/**
 * Get value from hamt
 * Outputs value on stdout if found. Otherwis exits with code 1.
 * @param hamt address of hamt program state
 * @param key string key to fetch
 */
const getValue = async (hamt, key) => {
  const result = await lookup(connection, new PublicKey(hamt), key);

  if (result.value === undefined) {
    process.exit(1);
  } else {
    console.log(result.value.toString())
    process.exit(0);
  }
}

/**
 * Execute many transactions against that HAMT and record performance.
 * @param hamt address of hamt to execute against
 * @param count number of values to set into HAMT
 */
const bench = async (hamt, count) => {
  const hamtKey = new PublicKey(hamt)
  const timeStats = { count: 0, total: 0 }
  const feeStats = { count: 0, total: 0 }
  const rentStats = { count: 0, total: 0 }
  const computeStats = { count: 0, total: 0 }

  let lowestSet = 0;
  let highestSet = parseInt(count)
  let batchSize = 1;
  let errorSets = []
  while (lowestSet < highestSet || errorSets.length != 0) {
    const newSets = Math.min(batchSize - errorSets.length, highestSet-lowestSet)
    const results = await Promise.all([
      ...errorSets.map(s=>_setValueForBench(hamtKey, s.key, s.value)),
      ...Array(newSets).fill().map((_,i)=>_setValueForBench(hamtKey, `test${i+lowestSet}`, i+lowestSet))
    ])
    lowestSet += newSets
    results.forEach(r => {
      if (r.error) return;
      updateStats(r.millis, timeStats)
      updateStats(r.rent, rentStats)
      updateStats(r.fee, feeStats)
      updateStats(r.compute, computeStats)
    })

    errorSets = results.filter(r => r.error)
    console.log(lowestSet, ": completed", batchSize, "sets with", errorSets.length, "errors")
    batchSize = Math.min(256, batchSize*2)
  }

  console.log(`Set ${count} values.`)
  console.log(`Time (ms): ${statStr(timeStats)}`)
  console.log(`Fee (lamports): ${statStr(feeStats)}`)
  console.log(`Rent (lamports): ${statStr(rentStats)}`)
  console.log(`Compute: ${statStr(computeStats)}`)
  console.log()

  for await (let i of range(count)) {
    const key = `test${i}`
    const result = await lookup(connection, hamtKey, key);

    if (result.value === undefined) {
      console.log(`Could not find ${key} in HAMT`)
      process.exit(1)
    }

    if (result.value != BigInt(i)) {
      console.log(`Expected ${i} for ${key}, but got ${result.value.toString()}`)
      process.exit(1)
    }
  }
  console.log("All keys found")
  process.exit(0)
}

/**
 * Internal functions
 */
const _setValue = async (hamt, key, value) => {
  const result = await lookup(connection, hamt, key);

  const baseKeys = [
    { pubkey: signerAccount.publicKey, isSigner: true, isWritable: false },
    { pubkey: hamt, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
  ]

  const nodeKeys = result.path.map(pubkey => ({ pubkey: pubkey, isSigner: false, isWritable: false }))
  nodeKeys[nodeKeys.length - 1].isWritable = true

  const nodeRent = await connection.getMinimumBalanceForRentExemption(HAMTNodeSize, 'singleGossip');
  const collisionAccounts = Array(result.collisions).fill().map(()=>new Account());
  const collisionInstructions = collisionAccounts.map((acc)=>SystemProgram.createAccount({
    space: HAMTNodeSize,
    lamports: nodeRent,
    fromPubkey: signerAccount.publicKey,
    newAccountPubkey: acc.publicKey,
    programId: programID
  }));
  const collisionKeys = collisionAccounts.map(acc=>({ pubkey: acc.publicKey, isSigner: false, isWritable: true }))

  result.rent = nodeRent * result.collisions;
  result.collisionAccounts = collisionAccounts;

  const valueBN = BigInt(value)
  const setIx = new TransactionInstruction({
    programId: programID,
    keys: [...baseKeys, ...nodeKeys, ...collisionKeys],
    data: serializeSetValueInstruction(key, valueBN),
  })

  const tx = new Transaction().add(...collisionInstructions, setIx);
  result.txSignature = await connection.sendTransaction(
      tx, 
      [signerAccount, ...collisionAccounts], 
      {skipPreflight: false, preflightCommitment: 'singleGossip'});
  return result
}

const _setValueForBench = async (hamt, key, value) => {
  const computeRegexp = /consumed (\d+) of \d+ compute units/
  try {
    const start = Date.now();
    const result =  await _setValue(hamt, key, value)
    const confirm = await connection.confirmTransaction(result.txSignature)
    result.millis = Date.now() - start;

    if (confirm.value.err) throw err

    const txData = await connection.getTransaction(result.txSignature, {commitment: 'confirmed'})
    result.fee =  txData.meta.fee
    result.compute = parseInt(txData.meta.logMessages
      .filter(l=>l.match(computeRegexp))[0]
      .match(computeRegexp)[1])
    
    return result
  } catch (error) {
    console.log(`Error setting ${key}`)
    return { error, key, value }
  }
}

const updateStats = (stat, stats) => {
  stats.total += stat
  stats.count += 1
  stats.min = stats.min == undefined ? stat : Math.min(stat, stats.min)
  stats.max = stats.max == undefined ? stat : Math.max(stat, stats.max)
}

const statStr = (stats) => (
  `avg: ${(stats.total/stats.count).toFixed(2)}, max: ${stats.max}, min: ${stats.min}`
)

/**
 * Range iterator for bench
 */
const range = (count) => ({
  [Symbol.asyncIterator]() {
    return {
      current: 0,
      last: count,

      async next() {
        if (this.current < this.last) {
          return { done: false, value: this.current++ };
        } else {
          return { done: true };
        }
      }
    };
  }
})

/**
 * Command CLI
 */
 const program = new Command();
 program
   .command('init')
   .description('create a new HAMT state account')
   .action(initHAMT);
 program
   .command('set <hamt> <key> <value>')
   .description('sets an integer value for a key into the hamt')
   .action(setValue);
 program
   .command('get <hamt> <key>')
   .description('retrieves a value from the hamt')
   .action(getValue);
 program
   .command('bench <hamt> <count>')
   .description('sets count values into the hamt, verifies them, and prints stats')
   .action(bench);
 program.parse(process.argv)
 