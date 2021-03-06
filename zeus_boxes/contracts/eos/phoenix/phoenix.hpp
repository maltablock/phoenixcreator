#pragma once

#define __TEST__
#define __KYLIN__

#ifndef __KYLIN__
#define LIQUIDX
#endif

#define USE_ADVANCED_IPFS
// #define USE_IPFS_WARMUPROW

#ifdef __TEST__
#define VACCOUNTS_DELAYED_CLEANUP 0
#else
#define VACCOUNTS_DELAYED_CLEANUP 0
#endif

#include "../dappservices/cron.hpp"
#include "../dappservices/multi_index.hpp"
#include "../dappservices/vaccounts.hpp"
#include "./constants.hpp"
#include <eosio/eosio.hpp>
#include <eosio/system.hpp>

#define DAPPSERVICES_ACTIONS()                                                 \
  XSIGNAL_DAPPSERVICE_ACTION                                                   \
  CRON_DAPPSERVICE_ACTIONS                                                     \
  IPFS_DAPPSERVICE_ACTIONS                                                     \
  VACCOUNTS_DAPPSERVICE_ACTIONS

#define DAPPSERVICE_ACTIONS_COMMANDS()                                         \
  CRON_SVC_COMMANDS()                                                          \
  IPFS_SVC_COMMANDS()                                                          \
  VACCOUNTS_SVC_COMMANDS()
#define CONTRACT_NAME() phoenix

using std::string;

using namespace std;
using namespace eosio;

CONTRACT_START()
private:
TABLE globals {
  std::vector<uint64_t> latest_post_indexes = std::vector<uint64_t>{};
  uint64_t next_post_id = 0;
  std::vector<name> featured_authors = std::vector<name>{};
  std::vector<uint64_t> featured_posts = std::vector<uint64_t>{};
  bool paused = false;
};
// just so it is added to the ABI, as singletons are currently not
typedef eosio::multi_index<"globals"_n, globals> globals_t_abi;
typedef eosio::singleton<"globals"_n, globals> globals_sgt;
globals_sgt _globals;

TABLE limits {
  uint32_t day_identifier = 0;
  uint32_t vaccounts_created_today = 0;
  uint32_t max_vaccount_creations_per_day = 50;
};
// just so it is added to the ABI, as singletons are currently not
typedef eosio::multi_index<"limits"_n, limits> limits_t_abi;
typedef eosio::singleton<"limits"_n, limits> limits_sgt;
limits_sgt _limits;

/**
 * User
 */
struct user_profile_info {
  std::string displayName;
  std::string logoSrc;
  std::string headerSrc;
  std::string description;
  std::string website;
  std::map<name, std::string> social;
  bool explicit_content = false;
};
struct pledge_tier {
  std::string title;
  std::string description;
  std::vector<std::string> benefits;
  float usd_value;
};

struct [[eosio::table]] user_info {
  name username;
  name linked_name = ""_n;     // account of EOS name
  name created_account = ""_n; // free WAX poenix account created by user
  user_profile_info profile_info;
  std::vector<pledge_tier> tiers;
  // as there's no support for secondary indexes on vRAM, we need to keep the
  // "foreign key" relationships in the user
  std::vector<uint64_t> post_indexes = std::vector<uint64_t>{};
  // first 64bits of email derivation hash
  // checked when setting new key, needed for security as easy
  // to do email -> account name collisions (31^7)
  uint64_t checksum;

  auto primary_key() const { return username.value; }
};

typedef dapp::multi_index<name("users"), user_info> users_table;
typedef eosio::multi_index<".users"_n, user_info> users_table_v_abi;
TABLE shardbucket {
  std::vector<char> shard_uri;
  uint64_t shard;
  uint64_t primary_key() const { return shard; }
};
typedef eosio::multi_index<"users"_n, shardbucket> users_table_abi;

users_table _users;

/**
 * Custom URL path
 */
// creates a two way binding by using scopes
// scope: phoenix && key: username => url in url
// scope: url && key: 0 => username in url
struct [[eosio::table]] customurl {
  name username;
  name url;

  auto primary_key() const { return username.value; }
};

typedef dapp::multi_index<name("customurl"), customurl> customurl_table;
typedef eosio::multi_index<".customurl"_n, customurl> customurl_table_v_abi;
typedef eosio::multi_index<"customurl"_n, shardbucket> customurl_table_abi;

/**
 * Post
 */
struct [[eosio::table]] post_info {
  uint64_t id;
  name author;
  std::vector<uint8_t> title;
  std::vector<uint8_t> content;
  eosio::time_point_sec created;
  eosio::time_point_sec updated;
  std::vector<uint8_t> featured_image_url;
  std::string meta;
  bool encrypted = false;
  float decrypt_for_usd = 0;

  auto primary_key() const { return id; }
};

typedef dapp::multi_index<name("posts"), post_info> posts_table;
typedef eosio::multi_index<".posts"_n, post_info> posts_table_v_abi;
typedef eosio::multi_index<"posts"_n, shardbucket> posts_table_abi;

posts_table _posts;

// Scope: DSP account
struct [[eosio::table("postkeyenc")]] post_key_encryption {
  uint64_t post_id;
  std::vector<uint8_t> post_key;
  auto primary_key() const { return post_id; }
};
typedef dapp::multi_index<name("postkeyenc"), post_key_encryption>
    post_key_enc_table;
typedef eosio::multi_index<".postkeyenc"_n, post_key_encryption>
    post_key_enc_table_v_abi;
typedef eosio::multi_index<"postkeyenc"_n, shardbucket> post_key_enc_table_abi;

/**
 * Follows
 * would just be a from,to table with index on both
 * but DAPP network does not support secondary indexes
 * so split it into two tables and duplicate data
 * scope="from", scope="to"
 */
struct [[eosio::table]] follows_info {
  name user;
  std::vector<name> users;

  auto primary_key() const { return user.value; }
};

typedef dapp::multi_index<name("follows"), follows_info>
    follows_table;
typedef eosio::multi_index<".follows"_n, follows_info>
    follows_table_v_abi;
typedef eosio::multi_index<"follows"_n, shardbucket> follows_table_abi;


/**
 * Pledges
 */
struct [[eosio::table]] pledge_info {
  uint64_t id;
  name from;
  name to;
  eosio::microseconds cycle_us;
  // taken from subscription tier
  float usd_value;
  // value of (eos_quantity + phoenix_quantity) at time of pledge must be >=
  // usd_value
  eosio::asset weosdt_quantity = asset(0, WEOSDT_EXT_SYMBOL.get_symbol());
  eosio::time_point cycle_start;
  /* if pledge should auto renew next cycle */
  bool autorenew = false;
  /* arguments to update the pledge to in the next cycle */
  eosio::microseconds next_cycle_us = microseconds(0);
  // taken from subscription tier
  float next_usd_value;
  eosio::asset next_weosdt_quantity = asset(0, WEOSDT_EXT_SYMBOL.get_symbol());
  /* remove the pledge after next cycle */
  bool next_delete = false;
  bool paid = false;

  auto primary_key() const { return id; }
};

typedef dapp::multi_index<name("pledges"), pledge_info> pledges_table;
typedef eosio::multi_index<".pledges"_n, pledge_info> pledges_table_v_abi;
typedef eosio::multi_index<"pledges"_n, shardbucket> pledges_table_abi;

pledges_table _pledges;

struct name_pledge_pair {
  name name;
  uint64_t pledge_id;
};
struct [[eosio::table]] pledges_rel_info {
  name user;
  std::vector<name_pledge_pair> users;

  auto primary_key() const { return user.value; }
};

typedef dapp::multi_index<name("pledgesrel"), pledges_rel_info>
    pledges_rel_table;
typedef eosio::multi_index<".pledgesrel"_n, pledges_rel_info>
    pledges_rel_table_v_abi;
typedef eosio::multi_index<"pledgesrel"_n, shardbucket> pledges_rel_table_abi;

// just so it is added to the ABI, as singletons are currently not
// TABLE vconfig {
//   uint64_t next_available_key;
//   uint32_t shards;
//   uint32_t buckets_per_shard;
// };
// typedef eosio::multi_index<".vconfig"_n, vconfig> vconfig_t_abi;
// typedef eosio::singleton<".vconfig"_n, vconfig> vconfig_sgt;

public:
phoenix(name receiver, name code, datastream<const char *> ds)
    : contract(receiver, code, ds), _globals(receiver, receiver.value),
      _limits(receiver, receiver.value),
      _users(receiver, receiver.value, 1024, 64, false, false,
             VACCOUNTS_DELAYED_CLEANUP),
      _posts(receiver, receiver.value, 1024, 64, false, false,
             VACCOUNTS_DELAYED_CLEANUP),
      _pledges(receiver, receiver.value, 1024, 64, false, false,
               VACCOUNTS_DELAYED_CLEANUP) {}

struct updateuser_payload {
  name vaccount;
  user_profile_info new_profile_info;
  name url;
  EOSLIB_SERIALIZE(updateuser_payload, (vaccount)(new_profile_info)(url))
};

struct updatetiers_payload {
  name vaccount;
  std::vector<pledge_tier> new_tiers;
  EOSLIB_SERIALIZE(updatetiers_payload, (vaccount)(new_tiers))
};

struct createpost_payload {
  uint64_t expected_id = 0;
  name vaccount; // account of EOS name, will be scope
  std::vector<uint8_t> title;
  std::vector<uint8_t> content;
  std::vector<uint8_t> featured_image_url;
  std::string meta;
  bool encrypted;
  float decrypt_for_usd;
  std::vector<uint8_t> post_key;
  EOSLIB_SERIALIZE(createpost_payload,
                   (expected_id)(vaccount)(title)(content)(featured_image_url)(
                       meta)(encrypted)(decrypt_for_usd)(post_key))
};

struct updatepost_payload {
  name vaccount;
  uint64_t id;
  std::vector<uint8_t> title;
  std::vector<uint8_t> content;
  std::vector<uint8_t> featured_image_url;
  std::string meta;
  bool encrypted;
  float decrypt_for_usd;
  std::vector<uint8_t> post_key;
  bool delete_post = false;
  EOSLIB_SERIALIZE(updatepost_payload,
                   (vaccount)(id)(title)(content)(featured_image_url)(meta)(
                       encrypted)(decrypt_for_usd)(post_key)(delete_post))
};

struct follow_payload {
  name vaccount;
  std::vector<name> follows;
  std::vector<name> unfollows;
  EOSLIB_SERIALIZE(follow_payload, (vaccount)(follows)(unfollows))
};

struct linkaccount_payload {
  name vaccount;
  name account;
  EOSLIB_SERIALIZE(linkaccount_payload, (vaccount)(account))
};

// struct withdraw_payload {
//   name from;
//   name to_eos_account;
//   asset quantity;
//   EOSLIB_SERIALIZE(withdraw_payload, (from)(to_eos_account)(quantity))
// };

struct pledge_payload {
  name vaccount;
  name to;
  double usd_value;
  eosio::asset weosdt_quantity;
  bool autorenew = false;
  bool next_delete = false;
  EOSLIB_SERIALIZE(pledge_payload, (vaccount)(to)(usd_value)(weosdt_quantity)(
                                       autorenew)(next_delete))
};

struct renewpledge_payload {
  name vaccount;
  name to;
  uint64_t pledge_id;
  EOSLIB_SERIALIZE(renewpledge_payload, (vaccount)(to)(pledge_id))
};

struct timer_payload {
  name type;
  std::vector<char> payload;
  EOSLIB_SERIALIZE(timer_payload, (type)(payload))
};

ACTION init(eosio::public_key phoenix_vaccount_pubkey);
ACTION setlimits(const uint32_t &max_vaccount_creations_per_day);
ACTION setfeatured(std::vector<name> featured_authors, std::vector<uint64_t> featured_posts);
ACTION signup(const name &vaccount, const eosio::public_key &pubkey, const uint64_t &checksum);
ACTION login(const name &vaccount, const eosio::public_key &pubkey, const uint64_t &checksum);
ACTION pause(bool pause);
ACTION logcreateacc(name vaccount, name created_account, eosio::public_key pubkey);

ACTION updateuser(const updateuser_payload &payload);
ACTION updatetiers(const updatetiers_payload &payload);
ACTION createpost(createpost_payload payload);
ACTION updatepost(updatepost_payload payload);
ACTION follow(follow_payload payload);
ACTION linkaccount(linkaccount_payload payload);
ACTION pledge(pledge_payload payload);
ACTION renewpledge(renewpledge_payload payload);
#ifdef __TEST__
ACTION testreset(uint64_t count);
#endif
void on_transfer(eosio::name from, eosio::name to, eosio::asset quantity,
                 std::string memo);
bool timer_callback(name timer, std::vector<char> payload, uint32_t seconds);


using renewpledge_action =
    eosio::action_wrapper<"renewpledge"_n, &phoenix::renewpledge>;

public:
VACCOUNTS_APPLY(((updateuser_payload)(updateuser))(
    (updatetiers_payload)(updatetiers))((createpost_payload)(createpost))(
    (updatepost_payload)(updatepost))((follow_payload)(follow))(
    (linkaccount_payload)(linkaccount))((pledge_payload)(pledge))((renewpledge_payload)(renewpledge)))

/* helper functions */
private:
auto check_user(const name &name);
void check_running();
uint64_t create_pledge(const pledge_payload &payload);
void update_pledge(const pledge_payload &payload, const uint64_t &pledge_id);
void upsert_pledge_relations(const pledge_payload &payload, uint64_t pledge_id);
void pay_pledge(const name &payer, const uint64_t &pledge_id);
void update_latest_posts(const uint64_t &post_id);
void remove_from_latest_post(const uint64_t &post_id);
void schedule_renewpledge(const pledge_info &pledge);
void regaccount_hook(const regaccount_action &action);
void internal_vtransfer(const eosio::name &from, const eosio::name &to,
                        const eosio::asset &quantity, const std::string &memo);
std::pair<eosio::asset, eosio::asset>
get_or_throw_next_pledge_quantities(pledge_info p);
globals get_globals() {
  globals g = _globals.get_or_default(globals());
  return g;
}
}
;
