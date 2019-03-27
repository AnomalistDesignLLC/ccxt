'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError, ExchangeNotAvailable, AuthenticationError, InvalidOrder, OrderNotFound, DDoSProtection } = require ('./base/errors');

//  ---------------------------------------------------------------------------

module.exports = class bitasset extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'bitasset',
            'name': 'Bitasset',
            'countries': [ 'US' ],
            'version': 'v1',
            'rateLimit': 1500,
            'certified': true,
            // new metainfo interface
            'has': {
                'fetchBalance': true,
                'fetchMarkets': true,
                'fetchCurrencies': true,
                'CORS': false,
                'createMarketOrder': false,
                'fetchDepositAddress': false,
                'fetchClosedOrders': false,
                'fetchTrades': false,
                'fetchOHLCV': false,
                'fetchOrder': false,
                'fetchOpenOrders': false,
                'fetchTicker': false,
                'withdraw': false,
                'fetchDeposits': false,
                'fetchWithdrawals': false,
                'fetchTransactions': false,
                'fetchOrderBook': false,
                'fetchL2OrderBook': false,
            },
            'hostname': 'api.bitasset.com',
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/27766352-cf0b3c26-5ed5-11e7-82b7-f3826b7a97d8.jpg',
                'api': {
                    'public': 'https://{hostname}',
                    'accounts': 'https://{hostname}',
                },
                'www': 'https://bitasset.com',
                'doc': [
                    'https://bitasset.github.io/api/',
                    'https://www.npmjs.com/package/bitasset-node',
                ],
                'fees': [
                    'https://bitasset.zendesk.com/hc/en-us/articles/115003684371-bitasset-SERVICE-FEES-AND-WITHDRAWAL-LIMITATIONS',
                    'https://bitasset.zendesk.com/hc/en-us/articles/115000199651-What-fees-does-bitasset-charge-',
                ],
            },
            'api': {
                'public': {
                    'get': [
                        'symbols',
                        'currencies',
                    ],
                },
                'accounts': {
                    'get': [
                        'balance',
                    ],
                },
            },
        });
    }

    async fetchMarkets (params = {}) {
        const response = await this.publicGetSymbols ();
        const result = [];
        const markets = this.safeValue (response, 'data');
        for (let i = 0; i < markets.length; i++) {
            const market = markets[i];
            let id = market['id'];
            let baseId = market['baseCurrency'];
            let quoteId = market['quoteCurrency'];
            let base = this.commonCurrencyCode (baseId);
            let quote = this.commonCurrencyCode (quoteId);
            let symbol = base + '/' + quote;
            result.push ({
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
            });
        }
        return result;
    }

    async fetchCurrencies (params = {}) {
        const response = await this.publicGetCurrencies (params);
        const currencies = this.safeValue (response, 'data', []);
        const result = {};
        for (let i = 0; i < currencies.length; i++) {
            const currency = currencies[i];
            const id = this.safeString (currency, 'id');
            const code = this.commonCurrencyCode (id);
            const name = this.safeString (currency, 'name');
            result[name] = {
                'id': id,
                'name': name,
                'code': code,
            };
        }
        return result;
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        let response = await this.accountsGetBalance (params);
        let balances = response['data'];
        let result = { 'info': balances };
        let indexed = this.indexBy (balances, 'currency');
        let keys = Object.keys (indexed);
        for (let i = 0; i < keys.length; i++) {
            let id = keys[i];
            let currency = this.commonCurrencyCode (id);
            let account = this.account ();
            let balance = indexed[id];
            let free = this.safeFloat (balance, 'available', 0);
            let total = this.safeFloat (balance, 'balance', 0);
            let used = this.safeFloat (balance, 'frozen', 0);
            account['free'] = free;
            account['used'] = used;
            account['total'] = total;
            result[currency] = account;
        }
        return this.parseBalance (result);
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.implodeParams (this.urls['api'][api], {
            'hostname': this.hostname,
        }) + '/';
        url += this.version + '/cash/';
        if (api === 'public') {
            url += api + '/' + path;
            if (Object.keys (params).length)
                url += '?' + this.urlencode (params);
        } else {
            this.checkRequiredCredentials ();
            url += api + '/';
            const request = {
                'apiAccessKey': this.apiKey,
            };
            request['apiTimeStamp'] = this.milliseconds ();
            url += path + '?' + this.urlencode (this.extend (request, params));
            let secret = this.hash (this.encode (this.secret), 'sha1');
            let signature = this.hmac (this.urlencode (this.extend (request, params)), this.encode (secret), 'SHA256');
            url += '&' + this.urlencode (this.extend ({
                'apiSign': signature,
            }));
            headers = {};
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    handleErrors (code, reason, url, method, headers, body, response) {
        if (body[0] === '{') {
            // { success: false, message: "message" }
            let success = this.safeValue (response, 'msg');
            if (success === undefined)
                throw new ExchangeError (this.id + ': malformed response: ' + this.json (response));
            if (typeof success === 'string') {
                // bleutrade uses string instead of boolean
                success = (success === 'success') ? true : false;
            }
            if (!success) {
                const message = this.safeString (response, 'message');
                const feedback = this.id + ' ' + this.json (response);
                const exceptions = this.exceptions;
                if (message === 'APIKEY_INVALID') {
                    if (this.options['hasAlreadyAuthenticatedSuccessfully']) {
                        throw new DDoSProtection (feedback);
                    } else {
                        throw new AuthenticationError (feedback);
                    }
                }
                if (message === 'DUST_TRADE_DISALLOWED_MIN_VALUE_50K_SAT')
                    throw new InvalidOrder (this.id + ' order cost should be over 50k satoshi ' + this.json (response));
                if (message === 'INVALID_ORDER') {
                    // Bitasset will return an ambiguous INVALID_ORDER message
                    // upon canceling already-canceled and closed orders
                    // therefore this special case for cancelOrder
                    // let url = 'https://bitasset.com/api/v1.1/market/cancel?apikey=API_KEY&uuid=ORDER_UUID'
                    let cancel = 'cancel';
                    let indexOfCancel = url.indexOf (cancel);
                    if (indexOfCancel >= 0) {
                        let parts = url.split ('&');
                        let orderId = undefined;
                        for (let i = 0; i < parts.length; i++) {
                            let part = parts[i];
                            let keyValue = part.split ('=');
                            if (keyValue[0] === 'uuid') {
                                orderId = keyValue[1];
                                break;
                            }
                        }
                        if (orderId !== undefined)
                            throw new OrderNotFound (this.id + ' cancelOrder ' + orderId + ' ' + this.json (response));
                        else
                            throw new OrderNotFound (this.id + ' cancelOrder ' + this.json (response));
                    }
                }
                if (message in exceptions)
                    throw new exceptions[message] (feedback);
                if (message !== undefined) {
                    if (message.indexOf ('throttled. Try again') >= 0)
                        throw new DDoSProtection (feedback);
                    if (message.indexOf ('problem') >= 0)
                        throw new ExchangeNotAvailable (feedback); // 'There was a problem processing your request.  If this problem persists, please contact...')
                }
                throw new ExchangeError (feedback);
            }
        }
    }

    appendTimezoneParse8601 (x) {
        let length = x.length;
        let lastSymbol = x[length - 1];
        if ((lastSymbol === 'Z') || (x.indexOf ('+') >= 0)) {
            return this.parse8601 (x);
        }
        return this.parse8601 (x + 'Z');
    }

    async request (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let response = await this.fetch2 (path, api, method, params, headers, body);
        // a workaround for APIKEY_INVALID
        if ((api === 'account') || (api === 'market'))
            this.options['hasAlreadyAuthenticatedSuccessfully'] = true;
        return response;
    }
};
