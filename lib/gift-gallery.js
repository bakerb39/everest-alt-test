'use strict';
const URI = 'ui://everest/gift-gallery/v1.html';
const HOST = 'https://papaya-cassata-7e507b.netlify.app';
function resource() {
  return { uri: URI, name: 'everest-gift-gallery', title: 'Everest ALT gift gallery', mimeType: 'text/html;profile=mcp-app',
    text: require('./gift-gallery-template'),
    _meta: {
      ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [HOST] } },
      'openai/widgetDescription': 'A visual gallery of simulated gifts with illustrative photos, prices, product categories and remaining-budget labels.',
      'openai/widgetPrefersBorder': true,
      'openai/widgetCSP': { connect_domains: [], resource_domains: [HOST] },
    } };
}
module.exports = { URI, resource };
