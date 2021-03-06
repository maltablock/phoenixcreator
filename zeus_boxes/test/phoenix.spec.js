require("mocha");

const { requireBox } = require("@liquidapps/box-utils");
const { assert } = require("chai"); // Using Assert style
const { getCreateKeys } = requireBox("eos-keystore/helpers/key-utils");
const {
  getNetwork,
  getCreateAccount,
  getEos,
  getLocalDSPEos,
  getTestContract,
} = requireBox("seed-eos/tools/eos/utils");
let Eos = require("eosjs");
const getDefaultArgs = requireBox("seed-zeus-support/getDefaultArgs");
let { PrivateKey, PublicKey } = require("eosjs-ecc");

const artifacts = requireBox("seed-eos/tools/eos/artifacts");
const deployer = requireBox("seed-eos/tools/eos/deployer");
const { genAllocateDAPPTokens, readVRAMData } = requireBox(
  "dapp-services/tools/eos/dapp-services"
);
const { loadModels } = requireBox("seed-models/tools/models");
const fetch = require("node-fetch");
const { createClient } = requireBox(
  "client-lib-base/client/dist/src/dapp-client-lib"
);
global.fetch = fetch;

const initHelpers = require("./phoenix.helpers");

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

let phoenixContractCodeName = "phoenix";
const phoenixCode = "phoenixv2c11";
let tokenContractCodeName = "phoenixtoken";
const tokenCode = "phoenixv2t11";
const vAccount1 = `vaccount2`;
const vAccount2 = `vaccount3`;
const vAccount3 = `vaccount4`;
const vAccountPhoenix = `phoenix`;
let phoenixArtifact = artifacts.require(`./${phoenixContractCodeName}/`);
let tokenArtifact = artifacts.require(`./${tokenContractCodeName}/`);

const endpoint = "http://localhost:13015";

const { runTrx, rpc } = initHelpers({ endpoint });

describe(`Phoenix tests`, () => {
  let selectedNetwork = getNetwork(getDefaultArgs());
  let eosPhoenixContract;
  let vTokenContract;
  let eosTokenContract;
  let privateWif;
  let testAccountNames = [`testacc1`, `testacc2`];
  let testAccountKeys = [];
  let vaccClient;

  before((done) => {
    (async () => {
      try {
        privateWif = await PrivateKey.randomKey();
        const publicKeyVAccount = privateWif.toPublic().toString();
        privateWif = privateWif.toWif();

        // deploy and generate + stake DAPP tokens
        const services = [`vaccounts`, `ipfs`, `cron`]; // await loadModels("dapp-services");
        console.log(`deploying`, phoenixCode);

        for (const [artifact, code] of [
          [phoenixArtifact, phoenixCode],
          [tokenArtifact, tokenCode],
        ]) {
          let deployedContract = await deployer.deploy(artifact, code, {
            ...getDefaultArgs(),
            // up stake to circumvent RAM issues
            stake: `10000000.0000`,
          });
          console.log(`deploy done`, code);
          for (const service of services) {
            console.log(`allocating service "${service}"`);
            await genAllocateDAPPTokens(deployedContract, service); // service.name
          }
        }
        console.log(`Allocating done`);

        // initialize vaccount service with chainId
        eosPhoenixContract = await getTestContract(phoenixCode);
        vTokenContract = await getTestContract(tokenCode);
        const chainId = (await rpc.get_info()).chain_id;

        try {
          await eosPhoenixContract.xvinit(
            {
              chainid: chainId,
            },
            {
              authorization: `${phoenixCode}@active`,
            }
          );
          await vTokenContract.xvinit(
            {
              host: phoenixCode,
            },
            {
              authorization: `${tokenCode}@active`,
            }
          );
          await vTokenContract.create(
            {
              issuer: tokenCode,
              maximum_supply: "17000000.000000000 WEOSDT",
            },
            {
              authorization: `${tokenCode}@active`,
            }
          );
          await eosPhoenixContract.init(
            {
              phoenix_vaccount_pubkey: `EOS1111111111111111111111111111111114T1Anm`,
            },
            {
              authorization: `${phoenixCode}@active`,
            }
          );
          console.log(`issuing all tokens to phoenix`);
          await vTokenContract.issue(
            {
              to: vAccountPhoenix,
              quantity: "17000000.000000000 WEOSDT",
              memo: ``,
            },
            {
              authorization: [`${tokenCode}@active`],
            }
          );
        } catch (err) {
          console.warn(`initialization went wrong`, err.message);
        }

        console.log(`registering vAccounts`);

        const dappClient = await createClient({
          httpEndpoint: endpoint,
          fetch,
        });

        vaccClient = await dappClient.service("vaccounts", phoenixCode);
        try {
          for (const vacc of [vAccount1, vAccount2, vAccount3]) {
            await eosPhoenixContract.signup(
              {
                vaccount: vacc,
                pubkey: publicKeyVAccount,
              },
              {
                authorization: `${phoenixCode}@active`,
              }
            );
          }

          console.log(`trying to read vram data`);
          let tableRes = await readVRAMData({
            contract: phoenixCode,
            key: vAccount1,
            table: `users`,
            scope: phoenixCode,
            keytype: `name`,
            keysize: 64,
          });
          console.log(tableRes.row);
        } catch (_err) {
          // ignore vaccount already exists error
          console.warn(`vaccount signup failed`, _err.message);
        }

        // create test accounts
        testAccountKeys = await Promise.all(
          testAccountNames.map(name => getCreateAccount(name))
        );

        // issue them some real WEOSDT
        const eosToken = await getLocalDSPEos("eosio.token", getDefaultArgs());
        eosTokenContract = await eosToken.contract("eosio.token");
        await eosTokenContract.create("eosio.token", `170000000.000000000 WEOSDT`, {
          authorization: [`eosio.token@active`]
        });
        await eosTokenContract.issue(
          {
            to: `eosio.token`,
            quantity: "170000000.000000000 WEOSDT",
            memo: ``
          },
          {
            authorization: [`eosio.token@active`]
          }
        );

        await Promise.all(
          testAccountNames.map(async name => {
            return eosTokenContract.transfer(
              {
                from: `eosio.token`,
                to: name,
                quantity: "10.000000000 WEOSDT",
                memo: ``
              },
              {
                authorization: `eosio.token@active`
              }
            );
          })
        );

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it("regs account and can login", (done) => {
    (async () => {
      try {
        const vAccounts = [vAccount1, vAccount2, vAccount3];
        // accounts were created before already
        for (const name of vAccounts) {
          let tableRes = await readVRAMData({
            contract: phoenixCode,
            key: name,
            table: `users`,
            scope: phoenixCode,
            keytype: `name`,
            keysize: 64,
          });
          assert.equal(tableRes.row.username, name, "wrong user name");
          console.log(`user ${name} exists`);
        }

        done();
      } catch (e) {
        console.error(e);
        done(e);
      }
    })();
  });

  it.skip("creates free phoenix EOSIO accounts", (done) => {
    (async () => {
      try {
        const eosioKeys = await getCreateKeys(`eosio`);
        const keyProvider = eosioKeys.active.privateKey;
        console.log(eosioKeys)
        await eosTokenContract.transfer(
          {
            from: `eosio`,
            to: tokenCode,
            quantity: "1000.0000 SYS",
            memo: ``
          },
          {
            authorization: [`eosio@active`],
            keyProvider,
          }
        );
        console.log(`TRANSFER DONE`)
        await vTokenContract.createacc(
          {
            account: `hellohello12`,
            pubkey: `EOS5cq98XjabcoYDNU3RWaMaE4gLSjqYQQL1YRuNZUi6MC2P4tGtD`
          },
          {
            authorization: `${tokenCode}@active`,
          }
        );

        done();
      } catch (e) {
        console.error(e);
        done(e);
      }
    })();
  });

  it("updates user info", (done) => {
    (async () => {
      try {
        const profileInfo = {
          displayName: `hello`,
          logoSrc: `logo`,
          headerSrc: `header`,
          description: `description`,
          website: `https://phoenix.url`,
          social: [],
          explicit_content: false,
        };

        await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "updateuser",
          {
            vaccount: vAccount1,
            new_profile_info: profileInfo,
          }
        );

        let tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount1,
          table: `users`,
          scope: phoenixCode,
        });
        assert.deepEqual(
          tableRes.row.profile_info,
          profileInfo,
          "wrong user profile Info"
        );

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it("updates custom link", (done) => {
    (async () => {
      try {
        await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "setcustomurl",
          {
            vaccount: vAccount1,
            url: `peterparker`,
          }
        );

        let tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount1,
          table: `customurl`,
          scope: phoenixCode,
        });
        assert.deepEqual(
          tableRes.row,
          {
            username: vAccount1,
            url: `peterparker`
          },
          "wrong custom link on user (1)"
        );

        tableRes = await readVRAMData({
          contract: phoenixCode,
          key: 0,
          table: `customurl`,
          scope: `peterparker`,
          keytype: `number`,
        });
        assert.deepEqual(
          tableRes.row,
          {
            username: ``,
            url: vAccount1,
          },
          "wrong custom link on user (2)"
        );

        // vaccount2 tries to steal vaccount1's custom url
        let failed = false;
        try {
          let res = await vaccClient.push_liquid_account_transaction(
            phoenixCode,
            privateWif,
            "setcustomurl",
            {
              username: vAccount1,
              url: `peterparker`,
            }
          );
          failed = Boolean(res.result.error);
        } catch (err) {
          failed = true;
        }

        assert.equal(failed, true, "should not be able to claim vaccount1's url");

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it("can create / edit / remove subscription tiers", (done) => {
    (async () => {
      try {
        const firstTier = {
          title: `Supporter`,
          description: `Thanks for your support`,
          benefits: ["free lunch", "free SMS"],
          usd_value: 5.0,
        };
        const secondTier = {
          title: `Fan`,
          description: `Thanks for idolizing`,
          benefits: ["free lunch", "free SMS"],
          usd_value: 10.0,
        };
        await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "updatetiers",
          {
            vaccount: vAccount1,
            new_tiers: [firstTier],
          }
        );
        await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "updatetiers",
          {
            vaccount: vAccount1,
            new_tiers: [firstTier, secondTier],
          }
        );

        let tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount1,
          table: `users`,
          scope: phoenixCode,
        });
        assert.deepEqual(
          tableRes.row.tiers,
          [firstTier, secondTier],
          "wrong initial first and second tier"
        );

        // update first tier
        const updatedFirstTier = {
          ...firstTier,
          title: `Backer`,
          usd_value: 1.0,
        };
        await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "updatetiers",
          {
            vaccount: vAccount1,
            new_tiers: [updatedFirstTier, secondTier],
          }
        );
        tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount1,
          table: `users`,
          scope: phoenixCode,
        });
        assert.deepEqual(
          tableRes.row.tiers,
          [updatedFirstTier, secondTier],
          "wrong updated first tier"
        );

        // delete first tier
        await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "updatetiers",
          {
            vaccount: vAccount1,
            new_tiers: [secondTier],
          }
        );
        tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount1,
          table: `users`,
          scope: phoenixCode,
        });
        assert.deepEqual(
          tableRes.row.tiers,
          [secondTier],
          "wrong tiers after removing first tier"
        );

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it.skip("can transfer WEOSDT to vaccounts", (done) => {
    (async () => {
      try {
        await vTokenContract.transfer(
          {
            from: vAccountPhoenix,
            to: vAccount1,
            quantity: "20.000000000 WEOSDT",
            memo: ``,
          },
          {
            authorization: `${tokenCode}@active`,
          }
        );

        let tableRes = await readVRAMData({
          contract: tokenCode,
          key: `WEOSDT`,
          table: `accounts`,
          scope: vAccount1,
          keytype: `symbol`,
        });
        assert.equal(tableRes.row.balance, `20.000000000 WEOSDT`, "wrong balance 1");

        await vaccClient.push_liquid_account_transaction(
          tokenCode,
          privateWif,
          "transferv",
          {
            vaccount: vAccount1,
            to: vAccount2,
            quantity: "20.000000000 WEOSDT",
            memo: ``,
          }
        );

        tableRes = await readVRAMData({
          contract: tokenCode,
          key: `WEOSDT`,
          table: `accounts`,
          scope: vAccount2,
          keytype: `symbol`,
        });
        assert.equal(tableRes.row.balance, `20.000000000 WEOSDT`, "wrong balance 2");

        // reset balances to 0
        await vaccClient.push_liquid_account_transaction(
          tokenCode,
          privateWif,
          "transferv",
          {
            vaccount: vAccount2,
            to: vAccountPhoenix,
            quantity: "20.000000000 WEOSDT",
            memo: ``,
          }
        );
        tableRes = await readVRAMData({
          contract: tokenCode,
          key: `WEOSDT`,
          table: `accounts`,
          scope: vAccount2,
          keytype: `symbol`,
        });
        assert.equal(tableRes.row.balance, `0.000000000 WEOSDT`, "wrong balance 3");

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it.skip("can create posts", (done) => {
    (async () => {
      try {
        await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "createpost",
          {
            vaccount: vAccount1,
            title: Buffer.from(`Title`, "utf8"),
            content: Buffer.from(postText, "utf8"),
            featured_image_url: Buffer.from(
              `https://blabla.test/14.jpg`,
              "utf8"
            ),
            meta: ``,
            encrypted: false,
            decrypt_for_usd: 0,
            post_key: [],
            expected_id: 0,
          }
        );

        let user1 = (
          await readVRAMData({
            contract: phoenixCode,
            key: vAccount1,
            table: `users`,
            scope: phoenixCode,
          })
        ).row;
        assert.equal(
          user1.post_indexes.length,
          1,
          `wrong post indexes length user 1`
        );
        assert.equal(user1.post_indexes[0], 0, `wrong post indexes for user 1`);

        let tableRes = await readVRAMData({
          contract: phoenixCode,
          key: Number.parseInt(user1.post_indexes[0]),
          table: `posts`,
          scope: phoenixCode,
        });
        // console.log(tableRes);
        assert(
          Buffer.from(tableRes.row.title).toString(`utf8`) === `Title`,
          "wrong title for post 1"
        );

        // post 2
        await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "createpost",
          {
            vaccount: vAccount2,
            title: Buffer.from(`Vaccount 2`, "utf8"),
            content: Buffer.from(`## Vaccount 2\n> content`, "utf8"),
            featured_image_url: Buffer.from(
              `https://blabla.test/14.jpg`,
              "utf8"
            ),
            meta: ``,
            encrypted: false,
            decrypt_for_usd: 0,
            post_key: [],
            expected_id: 1,
          }
        );

        let user2 = (
          await readVRAMData({
            contract: phoenixCode,
            key: vAccount2,
            table: `users`,
            scope: phoenixCode,
          })
        ).row;
        assert.equal(
          user2.post_indexes.length,
          1,
          `wrong post indexes length user 1`
        );
        assert.equal(user2.post_indexes[0], 1, `wrong post indexes for user 1`);

        tableRes = await readVRAMData({
          contract: phoenixCode,
          key: Number.parseInt(user2.post_indexes[0]),
          table: `posts`,
          scope: phoenixCode,
        });
        // console.log(tableRes);
        assert(
          Buffer.from(tableRes.row.title).toString(`utf8`) === `Vaccount 2`,
          "wrong title for post 2"
        );

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it.skip("can update the post", (done) => {
    (async () => {
      try {
        const res = await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "updatepost",
          {
            vaccount: vAccount1,
            id: 0,
            title: Buffer.from(`Updated Title`, "utf8"),
            content: Buffer.from(`## Markdown header\n> content`, "utf8"),
            featured_image_url: Buffer.from(
              `https://blabla.test/14.jpg`,
              "utf8"
            ),
            meta: ``,
            encrypted: false,
            decrypt_for_usd: 0,
            post_key: [],
            delete_post: false,
          }
        );
        let outputLines = res.result.processed.action_traces[0].console;
        // console.log(`output`, outputLines);

        const tableRes = await readVRAMData({
          contract: phoenixCode,
          key: 0,
          table: `posts`,
          scope: phoenixCode,
        });
        assert(
          Buffer.from(tableRes.row.title).toString(`utf8`) === `Updated Title`,
          "wrong title"
        );

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it.skip("can follow users", (done) => {
    (async () => {
      try {
        let res = await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "follow",
          {
            vaccount: vAccount1,
            follows: [vAccount2, vAccount3],
            unfollows: [],
          }
        );

        let outputLines = res.result.processed.action_traces[0].console;
        // console.log(`output`, outputLines);

        let tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount1,
          table: `follows`,
          scope: `from`,
        });
        assert.deepEqual(
          tableRes.row.users,
          [vAccount2, vAccount3],
          "wrong follows from vAccount1"
        );
        tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount2,
          table: `follows`,
          scope: `to`,
        });
        assert.deepEqual(
          tableRes.row.users,
          [vAccount1],
          "wrong follows to vAccount2"
        );
        tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount3,
          table: `follows`,
          scope: `to`,
        });
        assert.deepEqual(
          tableRes.row.users,
          [vAccount1],
          "wrong follows to vAccount3"
        );

        /**
         * Unfollow
         */
        res = await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "follow",
          {
            vaccount: vAccount1,
            follows: [],
            unfollows: [vAccount2],
          }
        );

        tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount1,
          table: `follows`,
          scope: `from`,
        });
        assert.deepEqual(
          tableRes.row.users,
          [vAccount3],
          "wrong follows from vAccount1 after unfollow"
        );
        tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount2,
          table: `follows`,
          scope: `to`,
        });
        assert.deepEqual(
          tableRes.row.users,
          [],
          "wrong follows to vAccount2 after unfollow"
        );

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it.skip("can link an eos account", (done) => {
    (async () => {
      const linkedAccount = testAccountNames[0];
      try {
        let res = await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "linkaccount",
          {
            vaccount: vAccount1,
            account: linkedAccount,
          }
        );

        let outputLines = res.result.processed.action_traces[0].console;
        // console.log(`output`, outputLines);

        let tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount1,
          table: `users`,
          scope: phoenixCode,
        });
        assert.deepEqual(
          tableRes.row.linked_name,
          linkedAccount,
          "wrong linked account"
        );

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it("can deposit and withdraw WEOSDT", (done) => {
    (async () => {
      const linkedAccount = testAccountNames[0];
      try {
        await eosTokenContract.transfer(
          linkedAccount,
          tokenCode,
          `5.000000000 WEOSDT`,
          `deposit ${vAccount1}`,
          {
            authorization: `${linkedAccount}@active`,
            keyProvider: [testAccountKeys[0].active.privateKey],
          }
        );
        let tableRes = await readVRAMData({
          contract: tokenCode,
          key: `WEOSDT`,
          table: `accounts`,
          scope: vAccount1,
          keytype: `symbol`,
        });
        assert.equal(
          tableRes.row.balance,
          `5.000000000 WEOSDT`,
          "wrong balance after deposit"
        );

        let res = await vaccClient.push_liquid_account_transaction(
          tokenCode,
          privateWif,
          "withdrawv",
          {
            vaccount: vAccount1,
            to_eos_account: linkedAccount,
            quantity: `2.000000000 WEOSDT`,
          }
        );

        let outputLines = res.result.processed.action_traces[0].console;
        // console.log(`output`, outputLines);
        tableRes = await readVRAMData({
          contract: tokenCode,
          key: `WEOSDT`,
          table: `accounts`,
          scope: vAccount1,
          keytype: `symbol`,
        });
        assert.equal(
          tableRes.row.balance,
          `3.000000000 WEOSDT`,
          "wrong balance after withdraw"
        );

        // overdraw balance should not be possible
        let failed = false;
        try {
          res = await vaccClient.push_liquid_account_transaction(
            tokenCode,
            privateWif,
            "withdrawv",
            {
              vaccount: vAccount1,
              to_eos_account: linkedAccount,
              quantity: `3.000000001 WEOSDT`,
            }
          );
          failed = Boolean(res.result.error);
        } catch (err) {
          failed = true;
        }

        assert.equal(failed, true, "should not be able to overdraw balance");

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it("can create a pledge to someone", (done) => {
    (async () => {
      try {
        const pledge = {
          from: vAccount1,
          to: vAccount2,
          usd_value: 2.0,
          weosdt_quantity: `2.000000000 WEOSDT`,
          autorenew: true,
          next_delete: false,
        };
        // create pledge
        let res = await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "pledge",
          {
            ...pledge,
            vaccount: pledge.from,
          }
        );


        let tableRes = await readVRAMData({
          contract: phoenixCode,
          key: 0,
          table: `pledges`,
          scope: phoenixCode,
        });
        assert.deepInclude(tableRes.row, { ...pledge, paid: false }, "wrong pledge info");

        tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount1,
          table: `pledgesrel`,
          scope: `from`,
        });
        assert.deepEqual(
          tableRes.row,
          { user: vAccount1, users: [{ name: vAccount2, pledge_id: "0" }] },
          "wrong pledgesfrom info"
        );

        tableRes = await readVRAMData({
          contract: phoenixCode,
          key: vAccount2,
          table: `pledgesrel`,
          scope: `to`,
        });
        assert.deepEqual(
          tableRes.row,
          { user: vAccount2, users: [{ name: vAccount1, pledge_id: "0" }] },
          "wrong pledgesto info"
        );

        // pay pledge
        await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "renewpledge",
          {
            vaccount: pledge.from,
            to: pledge.to,
            pledge_id: 0,
          }
        );

        tableRes = await readVRAMData({
          contract: phoenixCode,
          key: 0,
          table: `pledges`,
          scope: phoenixCode,
        });
        assert.deepInclude(tableRes.row, { ...pledge, paid: true }, "wrong pledge info 2");


        tableRes = await readVRAMData({
          contract: tokenCode,
          key: `WEOSDT`,
          table: `accounts`,
          scope: vAccount1,
          keytype: `symbol`,
        });
        assert.equal(
          tableRes.row.balance,
          `1.000000000 WEOSDT`,
          "wrong balance for pledger after pledge"
        );

        tableRes = await readVRAMData({
          contract: tokenCode,
          key: `WEOSDT`,
          table: `accounts`,
          scope: vAccount2,
          keytype: `symbol`,
        });
        assert.equal(
          tableRes.row.balance,
          `1.960000000 WEOSDT`,
          "wrong balance for receiver after pledge"
        );

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it("can update a pledge", (done) => {
    (async () => {
      try {
        const pledge = {
          from: vAccount1,
          to: vAccount2,
          usd_value: 5.9361,
          weosdt_quantity: `6.000000000 WEOSDT`,
          autorenew: false,
          next_delete: true,
        };
        let res = await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "pledge",
          {
            ...pledge,
            vaccount: pledge.from,
          }
        );

        let tableRes = await readVRAMData({
          contract: phoenixCode,
          key: 0,
          table: `pledges`,
          scope: phoenixCode,
        });
        assert.deepInclude(
          tableRes.row,
          {
            from: vAccount1,
            to: vAccount2,
            // values from previous create pledge test
            usd_value: 2,
            // updates values from here
            next_weosdt_quantity: `6.000000000 WEOSDT`,
            autorenew: false,
            next_delete: true,
          },
          "wrong pledge info"
        );
        assert.closeTo(
          tableRes.row.next_usd_value,
          5.9361,
          0.00001,
          "wrong next_usd_value pledge info"
        );

        done();
      } catch (e) {
        done(e);
      }
    })();
  });

  it("can renew a pledge", (done) => {
    (async () => {
      try {
        const pledge = {
          from: vAccount1,
          to: vAccount3,
          usd_value: 0.2,
          weosdt_quantity: `0.200000000 WEOSDT`,
          autorenew: true,
          next_delete: false,
        };
        console.log(`pledge creation`)
        let res = await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "pledge",
          {
            ...pledge,
            vaccount: pledge.from,
          }
        );
        // update pledge
        console.log(`pledge updation`)
        res = await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "pledge",
          {
            ...pledge,
            vaccount: pledge.from,
            usd_value: 0.1,
            weosdt_quantity: `0.100000000 WEOSDT`,
          }
        );

        // pledge should now be be at the end of its cycle
        await delay(6000);

        console.log(`renew pledge`)
        res = await vaccClient.push_liquid_account_transaction(
          phoenixCode,
          privateWif,
          "renewpledge",
          {
            vaccount: vAccount1,
            to: vAccount3,
            pledge_id: 1,
          }
        );

        let outputLines = res.result.processed.action_traces[0].console;
        // console.log(`output`, outputLines);

        let tableRes = await readVRAMData({
          contract: tokenCode,
          key: `WEOSDT`,
          table: `accounts`,
          scope: vAccount3,
          keytype: `symbol`,
        });
        assert.closeTo(
          Number.parseFloat(tableRes.row.balance.split(` `)[0]),
          0.7,
          0.0001,
          "wrong WEOSDT balance after renew pledge"
        );
        done();
      } catch (e) {
        done(e);
      }
    })();
  });
});

const postText = `<!-- start slipsum code -->

My money's in that office, right? If she start giving me some bullshit about it ain't there, and we got to go someplace else and get it, I'm gonna shoot you in the head then and there. Then I'm gonna shoot that bitch in the kneecaps, find out where my goddamn money is. She gonna tell me too. Hey, look at me when I'm talking to you, motherfucker. You listen: we go in there, and that nigga Winston or anybody else is in there, you the first motherfucker to get shot. You understand?

You think water moves fast? You should see ice. It moves like it has a mind. Like it knows it killed the world once and got a taste for murder. After the avalanche, it took us a week to climb out. Now, I don't know exactly when we turned on each other, but I know that seven of us survived the slide... and only five made it out. Now we took an oath, that I'm breaking now. We said we'd say it was the snow that killed the other two, but it wasn't. Nature is lethal but it doesn't hold a candle to man.

You think water moves fast? You should see ice. It moves like it has a mind. Like it knows it killed the world once and got a taste for murder. After the avalanche, it took us a week to climb out. Now, I don't know exactly when we turned on each other, but I know that seven of us survived the slide... and only five made it out. Now we took an oath, that I'm breaking now. We said we'd say it was the snow that killed the other two, but it wasn't. Nature is lethal but it doesn't hold a candle to man.

Now that there is the Tec-9, a crappy spray gun from South Miami. This gun is advertised as the most popular gun in American crime. Do you believe that shit? It actually says that in the little book that comes with it: the most popular gun in American crime. Like they're actually proud of that shit. 

Now that there is the Tec-9, a crappy spray gun from South Miami. This gun is advertised as the most popular gun in American crime. Do you believe that shit? It actually says that in the little book that comes with it: the most popular gun in American crime. Like they're actually proud of that shit. 

Normally, both your asses would be dead as fucking fried chicken, but you happen to pull this shit while I'm in a transitional period so I don't wanna kill you, I wanna help you. But I can't give you this case, it don't belong to me. Besides, I've already been through too much shit this morning over this case to hand it over to your dumb ass.

Normally, both your asses would be dead as fucking fried chicken, but you happen to pull this shit while I'm in a transitional period so I don't wanna kill you, I wanna help you. But I can't give you this case, it don't belong to me. Besides, I've already been through too much shit this morning over this case to hand it over to your dumb ass.

You think water moves fast? You should see ice. It moves like it has a mind. Like it knows it killed the world once and got a taste for murder. After the avalanche, it took us a week to climb out. Now, I don't know exactly when we turned on each other, but I know that seven of us survived the slide... and only five made it out. Now we took an oath, that I'm breaking now. We said we'd say it was the snow that killed the other two, but it wasn't. Nature is lethal but it doesn't hold a candle to man.

You think water moves fast? You should see ice. It moves like it has a mind. Like it knows it killed the world once and got a taste for murder. After the avalanche, it took us a week to climb out. Now, I don't know exactly when we turned on each other, but I know that seven of us survived the slide... and only five made it out. Now we took an oath, that I'm breaking now. We said we'd say it was the snow that killed the other two, but it wasn't. Nature is lethal but it doesn't hold a candle to man.

Now that there is the Tec-9, a crappy spray gun from South Miami. This gun is advertised as the most popular gun in American crime. Do you believe that shit? It actually says that in the little book that comes with it: the most popular gun in American crime. Like they're actually proud of that shit. 

<!-- end slipsum code -->`;
