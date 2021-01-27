const mysql     = require('mysql');
const https     = require('https');
const fs        = require('fs');
const cliProgress  = require('cli-progress');
 
var dbcon; 
var sfcon;

run();
async function run() {
    try { 
        let credentials = JSON.parse( fs.readFileSync('credentials_dev.json') );

        console.log( 'connecting');
        dbcon = mysql.createConnection( credentials.mysql );
        sfcon = await loginBySoap( credentials.sf ); 

        console.log( 'cleaning database');
        let owner = await getResourceOwner();
        await doQuery( `DELETE FROM baubles.resources` );
        await doQuery( 'DELETE FROM baubles.resource_dependencies ' );

        console.log( 'fetching apex classes');
        let res = await doToolingQuery( "SELECT Id, Name, Body, SymbolTable, CreatedDate, LastModifiedDate FROM ApexClass WHERE NamespacePrefix = null" ); 
        let prog = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        prog.start(res.length, 0);        
        for( let i = 0; i< res.length; ++i ){
            var cls = res[i];
            var code = cls.Body;
            let attributes = new Array();
            if( code.match( /@isTest\b/gmi ) ) attributes.push( 'is_test' );
            if( code.match( /@AuraEnabled\b/gmi ) ) attributes.push( 'aura_enabled' );
            if( code.match( /\binterface\b/gmi ) ) attributes.push( 'interface' );
            if( code.match( /\bstatic class\b/gmi ) ) attributes.push( 'static_class' );
            await doQuery( `INSERT INTO baubles.resources ( id, type, name, attributes, owner_id, created, updated ) 
                            VALUES ( '${cls.Id}', 'ApexClass', '${cls.Name}', '${attributes.join(', ')}', '${owner.id}', '${convUTC( cls.CreatedDate )}', '${convUTC( cls.LastModifiedDate )}' )` );
            prog.update(i);
        }
        prog.stop();

        console.log( 'fetching apex components');
        res = await doToolingQuery( "SELECT Id, Name, CreatedDate, LastModifiedDate FROM ApexComponent WHERE NamespacePrefix = null" ); 
        for( let i = 0; i< res.length; ++i ){
            var cls = res[i];
            await doQuery( `INSERT INTO baubles.resources 
                                ( id, type, name, owner_id, created, updated ) 
                            VALUES 
                                ( '${cls.Id}', 'ApexComponent', '${cls.Name}', '${owner.id}', '${convUTC( cls.CreatedDate )}', '${convUTC( cls.LastModifiedDate )}')` );
        }

        console.log( 'fetching aura definition bundles');
        res = await doToolingQuery( "SELECT Id, DeveloperName, CreatedDate, LastModifiedDate FROM AuraDefinitionBundle WHERE NamespacePrefix = null" ); 
        for( let i = 0; i< res.length; ++i ){
            var cls = res[i];
            await doQuery( `INSERT INTO baubles.resources 
                                ( id, type, name, owner_id, created, updated ) 
                            VALUES 
                                ( '${cls.Id}', 'AuraDefinitionBundle', '${cls.DeveloperName}', '${owner.id}', '${convUTC( cls.CreatedDate )}', '${convUTC( cls.LastModifiedDate )}')` );
        }

        console.log( 'fetching static resources');
        res = await doToolingQuery( "SELECT Id, Name, CreatedDate, LastModifiedDate FROM StaticResource WHERE NamespacePrefix = null" ); 
        for( let i = 0; i< res.length; ++i ){
            var cls = res[i];
            await doQuery( `INSERT INTO baubles.resources 
                                ( id, type, name, owner_id, created, updated ) 
                            VALUES 
                                ( '${cls.Id}', 'StaticResource', '${cls.Name}', '${owner.id}', '${convUTC( cls.CreatedDate )}', '${convUTC( cls.LastModifiedDate )}')` );
        }

        console.log( 'fetching resource_dependencies');
        let resources = await doQuery( `Select ID FROM baubles.resources`);
        prog.start(resources.length, 0);        
        for( let ri = 0; ri < resources.length; ++ri ){    
            prog.update(ri);
            res = await doToolingQuery( `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType
                                                    FROM MetadataComponentDependency 
                                                    WHERE MetadataComponentId = '${resources[ri].ID}'
                                                       OR RefMetadataComponentId = '${resources[ri].ID}'`) ;
            for( let i = 0; i< res.length; ++i ){
                var cmp = res[i];
                await doQuery( `INSERT INTO baubles.resource_dependencies 
                                ( resource_id, resource_name, resource_type, dependent_id, dependent_name, dependent_type ) 
                                VALUES 
                                ( '${cmp.MetadataComponentId}', '${cmp.MetadataComponentName}', '${cmp.MetadataComponentType}', '${cmp.RefMetadataComponentId}', '${cmp.RefMetadataComponentName}', '${cmp.RefMetadataComponentType}')` );
            }
        }
        prog.stop();        
    } catch (err) { 
        console.error(err);
    } finally {
        await dbcon.end();
    }
}

async function doToolingQuery( query_string ){
    return new Promise( ( resolve, reject ) => {
        var records = new Array();
        doToolingQueryChunk( `/services/data/v42.0/tooling/query/?q=${encodeURI(query_string)}`, resolve, reject, records );
    });
}

function doToolingQueryChunk( path, resolve, reject, records ){
    const options = {
        hostname: sfcon.metaUrl,
        path: path,
        method: 'GET',
        headers: {
            "Authorization" :  "Bearer " + sfcon.sessionId,
            "Content-Type" : "text/xml"
        }
    };
    
    const req = https.request( options, (res) => {
        var body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            body += chunk;
        });
        res.on('end', () => {
            var jresp = JSON.parse( body );

            if (res.statusCode >= 400) {
                reject(body);
                return;
            }
            
            records.push( ...jresp.records );
            if( jresp.done ) {
                resolve( records );
            } else {
                doToolingQueryChunk( jresp.nextRecordsUrl, resolve, reject, records );
            }
        });
    });

    req.on('error', (e) => {
        reject( `problem with request: ${e.message}` );
    });
    
    req.write('');
    req.end();
}

async function doQuery( query_string ){
    return new Promise( (resolve, reject) => { 
        dbcon.query( query_string, (err, records) => { 
            if (err) { reject( err ); }
            resolve( records );
        });
    });
}

async function getResourceOwner(){
    return new Promise( (resolve, reject) => { 
        try {
            dbcon.query( `select id, name from baubles.resource_owners where id = '${sfcon.organizationId}'`, (err, records) => { 
                if (err) { reject( err ); }

                if( !records || 0 == records.length ){
                    dbcon.query( `insert into baubles.resource_owners ( id, name ) values ('${sfcon.organizationId}', '${sfcon.metaUrl}')`, (err, records) => { 
                        if (err) { reject( err ); }
                        resolve({ id: sfcon.organizationId, name: sfcon.metaUrl });
                    });
                } else {
                    resolve( records[0] );
                }
            });
        } catch( err ){
            reject(err);
        }
    });
}

async function loginBySoap( {username, password, token, loginUrl}  ) {
    var soapLoginEndpoint = [ loginUrl, "services/Soap/u/42" ].join('/');
    var body =  `<se:Envelope xmlns:se="http://schemas.xmlsoap.org/soap/envelope/">
                    <se:Header/>
                    <se:Body>',
                    <login xmlns="urn:partner.soap.sforce.com">
                        <username>${username}</username>
                        <password>${password}${token}</password>
                    </login>
                    </se:Body>
                </se:Envelope>`;

    return new Promise( ( resolve, reject ) => {
        const options = {
            hostname: loginUrl,
            path: "/services/Soap/u/42", 
            method: 'POST',
            headers: {
                "Content-Type" : "text/xml",
                "SOAPAction" : '""'
            }
        };
        
        const req = https.request(options, (res) => {
            var body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    m = body.match(/<faultstring>([^<]+)<\/faultstring>/);
                    var faultstring = m && m[1];
                    reject( new Error(faultstring || body) );
                }

                var m;
                m = body.match(/<sessionId>([^<]+)<\/sessionId>/);
                var sessionId = m && m[1];
                m = body.match(/<userId>([^<]+)<\/userId>/);
                var userId = m && m[1];
                m = body.match(/<organizationId>([^<]+)<\/organizationId>/);
                var orgId = m && m[1];
                m = body.match(/<metadataServerUrl>([^<]+)<\/metadataServerUrl>/);
                var metaUrl = m && m[1];
                metaUrl = metaUrl && new URL( metaUrl ).hostname
                var idUrl = soapLoginEndpoint.split('/').slice(0, 3).join('/');
                idUrl += "/id/" + orgId + "/" + userId;
                var userInfo = {
                    id: userId,
                    organizationId: orgId,
                    sessionId: sessionId,
                    metaUrl: metaUrl
                };
        
                resolve( userInfo );
            });
        });

        req.on('error', (e) => {
            reject( `problem with request: ${e.message}` );
        });
        
        // Write data to request body
        req.write(body);
        req.end();
    });  
}

function convUTC( utc ){
    return utc && `${utc.match( /(.*)T/ )[1]} ${utc.match( /T(.*)\+/ )[1]}`;
}