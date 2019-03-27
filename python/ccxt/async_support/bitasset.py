# -*- coding: utf-8 -*-

# PLEASE DO NOT EDIT THIS FILE, IT IS GENERATED AND WILL BE OVERWRITTEN:
# https://github.com/ccxt/ccxt/blob/master/CONTRIBUTING.md#how-to-contribute-code

from ccxt.async_support.base.exchange import Exchange

# -----------------------------------------------------------------------------

try:
    basestring  # Python 3
except NameError:
    basestring = str  # Python 2
from ccxt.base.errors import ExchangeError
from ccxt.base.errors import AuthenticationError
from ccxt.base.errors import InvalidOrder
from ccxt.base.errors import OrderNotFound
from ccxt.base.errors import DDoSProtection
from ccxt.base.errors import ExchangeNotAvailable


class bitasset (Exchange):

    def describe(self):
        return self.deep_extend(super(bitasset, self).describe(), {
            'id': 'bitasset',
            'name': 'Bitasset',
            'countries': ['US'],
            'version': 'v1',
            'rateLimit': 1500,
            'certified': True,
            # new metainfo interface
            'has': {
                'fetchBalance': True,
                'fetchMarkets': True,
                'fetchCurrencies': True,
                'CORS': False,
                'createMarketOrder': False,
                'fetchDepositAddress': False,
                'fetchClosedOrders': False,
                'fetchTrades': False,
                'fetchOHLCV': False,
                'fetchOrder': False,
                'fetchOpenOrders': False,
                'fetchTicker': False,
                'withdraw': False,
                'fetchDeposits': False,
                'fetchWithdrawals': False,
                'fetchTransactions': False,
                'fetchOrderBook': False,
                'fetchL2OrderBook': False,
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
        })

    async def fetch_markets(self, params={}):
        response = await self.publicGetSymbols()
        result = []
        markets = self.safe_value(response, 'data')
        for i in range(0, len(markets)):
            market = markets[i]
            id = market['id']
            baseId = market['baseCurrency']
            quoteId = market['quoteCurrency']
            base = self.common_currency_code(baseId)
            quote = self.common_currency_code(quoteId)
            symbol = base + '/' + quote
            result.append({
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
            })
        return result

    async def fetch_currencies(self, params={}):
        response = await self.publicGetCurrencies(params)
        currencies = self.safe_value(response, 'data', [])
        result = {}
        for i in range(0, len(currencies)):
            currency = currencies[i]
            id = self.safe_string(currency, 'id')
            code = self.common_currency_code(id)
            name = self.safe_string(currency, 'name')
            result[name] = {
                'id': id,
                'name': name,
                'code': code,
            }
        return result

    async def fetch_balance(self, params={}):
        await self.load_markets()
        response = await self.accountsGetBalance(params)
        balances = response['data']
        result = {'info': balances}
        indexed = self.index_by(balances, 'currency')
        keys = list(indexed.keys())
        for i in range(0, len(keys)):
            id = keys[i]
            currency = self.common_currency_code(id)
            account = self.account()
            balance = indexed[id]
            free = self.safe_float(balance, 'available', 0)
            total = self.safe_float(balance, 'balance', 0)
            used = self.safe_float(balance, 'frozen', 0)
            account['free'] = free
            account['used'] = used
            account['total'] = total
            result[currency] = account
        return self.parse_balance(result)

    def sign(self, path, api='public', method='GET', params={}, headers=None, body=None):
        url = self.implode_params(self.urls['api'][api], {
            'hostname': self.hostname,
        }) + '/'
        url += self.version + '/cash/'
        if api == 'public':
            url += api + '/' + path
            if params:
                url += '?' + self.urlencode(params)
        else:
            self.check_required_credentials()
            url += api + '/'
            request = {
                'apiAccessKey': self.apiKey,
            }
            request['apiTimeStamp'] = self.milliseconds()
            url += path + '?' + self.urlencode(self.extend(request, params))
            secret = self.hash(self.encode(self.secret), 'sha1')
            signature = self.hmac(self.urlencode(self.extend(request, params)), self.encode(secret), 'SHA256')
            url += '&' + self.urlencode(self.extend({
                'apiSign': signature,
            }))
            headers = {}
        return {'url': url, 'method': method, 'body': body, 'headers': headers}

    def handle_errors(self, code, reason, url, method, headers, body, response):
        if body[0] == '{':
            # {success: False, message: "message"}
            success = self.safe_value(response, 'msg')
            if success is None:
                raise ExchangeError(self.id + ': malformed response: ' + self.json(response))
            if isinstance(success, basestring):
                # bleutrade uses string instead of boolean
                success = True if (success == 'success') else False
            if not success:
                message = self.safe_string(response, 'message')
                feedback = self.id + ' ' + self.json(response)
                exceptions = self.exceptions
                if message == 'APIKEY_INVALID':
                    if self.options['hasAlreadyAuthenticatedSuccessfully']:
                        raise DDoSProtection(feedback)
                    else:
                        raise AuthenticationError(feedback)
                if message == 'DUST_TRADE_DISALLOWED_MIN_VALUE_50K_SAT':
                    raise InvalidOrder(self.id + ' order cost should be over 50k satoshi ' + self.json(response))
                if message == 'INVALID_ORDER':
                    # Bitasset will return an ambiguous INVALID_ORDER message
                    # upon canceling already-canceled and closed orders
                    # therefore self special case for cancelOrder
                    # url = 'https://bitasset.com/api/v1.1/market/cancel?apikey=API_KEY&uuid=ORDER_UUID'
                    cancel = 'cancel'
                    indexOfCancel = url.find(cancel)
                    if indexOfCancel >= 0:
                        parts = url.split('&')
                        orderId = None
                        for i in range(0, len(parts)):
                            part = parts[i]
                            keyValue = part.split('=')
                            if keyValue[0] == 'uuid':
                                orderId = keyValue[1]
                                break
                        if orderId is not None:
                            raise OrderNotFound(self.id + ' cancelOrder ' + orderId + ' ' + self.json(response))
                        else:
                            raise OrderNotFound(self.id + ' cancelOrder ' + self.json(response))
                if message in exceptions:
                    raise exceptions[message](feedback)
                if message is not None:
                    if message.find('throttled. Try again') >= 0:
                        raise DDoSProtection(feedback)
                    if message.find('problem') >= 0:
                        raise ExchangeNotAvailable(feedback)  # 'There was a problem processing your request.  If self problem persists, please contact...')
                raise ExchangeError(feedback)

    def append_timezone_parse8601(self, x):
        length = len(x)
        lastSymbol = x[length - 1]
        if (lastSymbol == 'Z') or (x.find('+') >= 0):
            return self.parse8601(x)
        return self.parse8601(x + 'Z')

    async def request(self, path, api='public', method='GET', params={}, headers=None, body=None):
        response = await self.fetch2(path, api, method, params, headers, body)
        # a workaround for APIKEY_INVALID
        if (api == 'account') or (api == 'market'):
            self.options['hasAlreadyAuthenticatedSuccessfully'] = True
        return response