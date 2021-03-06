#pragma once

#include <eosio/system.hpp>
#include <cmath>
#include <string>
#include <vector>
#include <phoenix.hpp>


template <class T>
void diff_vectors(std::vector<T> &current, const std::vector<T> &add,
                  const std::vector<T> &remove) {
  std::copy(add.begin(), add.end(), std::back_inserter(current));
  std::unique(current.begin(), current.end());

  for (const T &to_remove : remove) {
    auto iter = std::find(current.begin(), current.end(), to_remove);
    if (iter != current.end()) {
      current.erase(iter);
    }
  }
}

double asset_to_decimal(const eosio::asset& quantity) {
  return (double)quantity.amount / pow(10, quantity.symbol.precision());
}

asset decimal_to_asset(const double& value, const eosio::symbol& symbol) {
  return {static_cast<int64_t>(value * pow(10, symbol.precision())), symbol};
}

uint32_t get_day_identifier() {
  return  eosio::current_time_point().time_since_epoch().to_seconds() / days(1).to_seconds();
}
