import * as request from './request'

export let entityConfig:{
    /**
     * spring-data-rest-base-path config
     */
    restBaseURL:string
} = {
    restBaseURL: '/'
};

/**
 * any is an instanceof Entity
 * @param any
 * @returns {boolean}
 */
export function isEntity(any:any):boolean {
    if (any instanceof Object) {
        let prototype = any.constructor.prototype.__proto__;
        while (prototype instanceof Object) {
            if (prototype.constructor === Entity) {
                return true;
            } else {
                prototype = prototype.__proto__;
            }
        }
    }
    return false;
}

/**
 * object deep equal,optimize for Entity
 * @param a
 * @param b
 * @returns {boolean} is equal ?
 */
export function equal(a:any, b:any):boolean {
    if (typeof a === typeof b) {
        if (isEntity(a) && isEntity(b)) {//Entity
            if ((a as Entity).id == (b as Entity).id) {
                return true;
            } else {
                return equal((a as Entity).data(), (b as Entity).data());
            }
        } else if (Array.isArray(a) && Array.isArray(b)) {//array
            if ((a as []).length === (b as []).length) {
                let re = true;
                (a as []).forEach((aV, i)=> {
                    re = re && equal(aV, (b as [])[i]);
                });
                return re;
            }
        } else if ((a instanceof Object) && (b instanceof Object)) {//object
            for (let key in a) {
                let re = true;
                if (a.hasOwnProperty(key) && b.hasOwnProperty(key)) {
                    re = re && equal(a[key], b[key]);
                } else {
                    return false;
                }
            }
        } else {
            return a == b;
        }
    }
    return false;
}

export class Entity {

    /**
     * springRest data entity id.
     * if id is set means this is a exists entity and can use methods:[save,exists,remove]
     * if id is null,means this is a new entity which will course save() method create a new object
     */
    id:string|number;

    /**
     * store one entity's data
     */
    private _data:{[key:string]:any} = {};

    /**
     * track modify field
     */
    modifyFields:string[] = [];

    /**
     * mock an entity instance with init data
     * @param initData
     */
    constructor(initData?:any) {
        this.patchData(initData);
    }

    /**
     * get this entity's spring data rest resource uri.
     * if this entity's has data and data has _link properties,use _data['_links']['self']['href']
     * else use config.restBaseURL + entityName + '/' + self.id
     */
    href():string {
        let links = this._data['_links'];
        if (links != null) {
            return links['self']['href'];
        } else {
            if (this.id) {
                return `${(this.constructor as typeof Entity).entityBaseURL()}/${this.id}`;
            } else {
                throw new Error(`entity without id can't map to backend service:\n${JSON.stringify(this)}`);
            }
        }
    }

    /**
     * get entity properties value by key
     * @param key properties name
     */
    get(key:string):any {
        return this._data[key];
    }

    /**
     * set entity properties value by key
     * will compare olaValue and newValue,if value is equal then not append filed name to modifyFields
     * @param key properties name
     * @param value
     */
    set(key:string, value:any) {
        let oldValue = this.get(key);
        if (!equal(oldValue, value)) {
            this.modifyFields.push(key);
        }
        this._data[key] = value;
    }

    /**
     * get entity data ref
     */
    data():any {
        return this._data;
    }

    /**
     * assign a patchData object to entity's properties
     * if patchData has self link, then id will update by parseIdFromData
     * @param patchData
     */
    patchData(patchData:{[key:string]:any}) {
        for (let key in patchData) {
            if (patchData.hasOwnProperty(key)) {
                this.set(key, patchData[key]);
            }
        }
        try {
            let id = patchData['_links']['self']['href'].split(/\//);
            id = id[id.length - 1];
            if (id != null) {
                this.id = id;
            }
        } catch (_) {
        }
    }

    /**
     * create an new entity
     * send HTTP POST request to create an entity
     */
    private create():Promise <{[key:string]:any}|void> {
        return new Promise((resolve, reject) => {
            (this.constructor as typeof Entity).translateRelationEntity(this.data()).then(body=> {
                return request.post((this.constructor as typeof Entity).entityBaseURL()).jsonBody(body).send();
            }).then(json => {
                this.patchData(json);
                this.modifyFields = [];
                resolve(json);
            }).catch(err=> {
                reject(err);
            })
        });
    }

    /**
     * update an entity
     * send HTTP PATCH request to update an entity(will watch change in data properties to track change fields)
     * @returns {Promise} resolve(json), reject(SpringRequest)
     * @private
     */
    private update():Promise<{[key:string]:any}|void> {
        return new Promise((resolve, reject)=> {
            let pureChange = {};
            if (this.modifyFields.length == 0) {//no modify
                resolve();
                return;
            }
            this.modifyFields.forEach(key=> {
                if (pureChange.hasOwnProperty(key) || key[0] === '_') {//this key has been set or start with _ will be skip
                    return;
                } else if (this._data.hasOwnProperty(key)) {
                    pureChange[key] = this.get(key);
                }
            });
            (this.constructor as typeof Entity).translateRelationEntity(pureChange).then((json)=> {
                return request.patch(this.href()).jsonBody(json).send();
            }).then((json) => {
                this.patchData(json);
                this.modifyFields = [];
                resolve(json);
            }).catch(err=> {
                reject(err);
            });
        });
    }

    /**
     * create or update entity
     * if id properties is set update change to service,
     * else create an new entity to service.
     *
     * if entity.properties is an instance of Entity or Entity[],then entity.properties.save() will also call,which mean entity's all Entity attr will auto save()
     */
    save():Promise<{[key:string]:any}|void> {
        if (this.id != null) {//update
            return this.update();
        } else {//create
            return this.create();
        }
    }

    /**
     * remove this entity
     */
    remove():Promise<void> {
        return (this.constructor as typeof Entity).remove(this.id);
    }

    /**
     * fetch entity data to keep updated to newest
     * @returns {Promise} resolve(json), reject(SpringRequest)
     */
    fetch():Promise<{[key:string]:any}> {
        return new Promise((resole, reject) => {
            (this.constructor as typeof Entity).findOne(this.id).then(entity => {
                let json = entity.data();
                this.patchData(json);
                this.modifyFields = [];
                resole(json);
            }).catch((err) => {
                reject(err);
            })
        });
    }

    /**
     * send request follow this entity's _links's href
     * @param {string[]} keys links href in order
     * @returns {Promise} resolve(json), reject(SpringRequest)
     */
    follow(keys):Promise<{[key:string]:any}> {
        return new Promise((resole, reject) => {
            function doFollow(data) {
                request.mockRequest(data).follow(keys).then((json) => {
                    resole(json);
                }).catch((err)=> {
                    reject(err);
                })
            }

            //fetch data before doFollow
            if (this._data['_links'] != null) {
                doFollow(this.data());
            } else {
                this.fetch().then(() => {
                    doFollow(this.data());
                })
            }
        });
    }

    /**
     * fetch relation property and store response value in entity's data attr,relation property is an instance of Entity.
     * after fetch you can get relation property by get(propertyName)
     * @param propertyName Entity relation property name in _links
     * @param T relation property's type(extend Entity class)
     * @returns {Promise<T>} resolve Entity relation property instance
     */
    fetchProperty<T extends Entity>(propertyName:string, T):Promise<T> {
        return new Promise((resolve, reject)=> {
            this.follow([propertyName]).then(json=> {
                let entity = T.jsonToEntity(json) as T;
                this.data()[propertyName] = entity;
                resolve(entity);
            }).catch(err=> {
                reject(err);
            })
        });
    }

    /**
     * fetch relation property and store response value in entity's data attr,relation property is an Entity array
     * after fetch you can get relation property by get(propertyName)
     * @param propertyName Entity relation property name in _links
     * @param T relation property's type(extend Entity class)
     * @returns {Promise<T>}
     */
    fetchArrayProperty<T extends Entity>(propertyName:string, T):Promise<T[]> {
        return new Promise((resolve, reject)=> {
            this.follow([propertyName]).then(json=> {
                let entities = T.jsonToEntityList(json) as T[];
                this.data()[propertyName] = entities;
                resolve(entities);
            }).catch(err=> {
                reject(err);
            })
        });
    }

    /**
     * spring data rest entity path
     */
    static entityName:string;

    /**
     * spring data rest entity base url
     */
    static entityBaseURL():string {
        return `${entityConfig.restBaseURL}/${this.entityName}`;
    }

    /**
     * read spring data rest's response json data then parse and return entity array
     * @param json
     */
    static jsonToEntityList(json:{[key:string]:any}):Entity[] {
        let re = [];
        let arr:any[] = json['_embedded'][this.entityName];
        arr.forEach(json=> {
            re.push(this.jsonToEntity(json));
        });
        re['page'] = json['page'];//add page info
        return re;
    }

    /**
     * read spring data rest's response json data then parse and return an entity
     * @param json
     */
    static jsonToEntity(json:{[key:string]:any}):Entity {
        let entity = new this(json);
        //json data from server is fresh,so entity modifyFields should be empty
        entity.modifyFields = [];
        return entity;
    }

    /**
     * this method use before send request to service to create or update entity
     * translate entity's data properties which contain Relation Entity instance value to text-uri list
     * if data has Entity attr,this Entity attr will be replace by is href() value,and if this entity has't be store in service will store this entity first.
     * @param data entity's data properties can has Entity attr
     *
     * resolve: pure json data can send to spring data rest service as request body
     * reject: SpringRequest with error prop
     */
    private static translateRelationEntity(data:any):Promise<any> {
        return new Promise((resolve, reject)=> {
            if (isEntity(data)) {//is a Entity instance
                <Entity>data.save().then(()=> {//create or update attr relation entity
                    resolve(data.href());
                }).catch((err)=> {
                    reject(err);
                })
            } else if (Array.isArray(data)) {
                let promiseList:Promise<any>[] = [];
                data.forEach(one=>promiseList.push(this.translateRelationEntity(one)));
                Promise.all(promiseList).then(arr=> {
                    resolve(arr);
                }).catch(err=> {
                    reject(err);
                });
            } else if (data != null && data.constructor === Object) {//is object
                let promiseList:Promise<any>[] = [];
                let indexKeyMap = {};
                let nowIndex = 0;
                for (let key in data) {
                    if (data.hasOwnProperty(key)) {
                        indexKeyMap[nowIndex++] = key;
                        promiseList.push(this.translateRelationEntity(data[key]));
                    }
                }
                Promise.all(promiseList).then((arr:any[])=> {
                    let json = {};
                    for (let i = 0; i < arr.length; i++) {
                        json[indexKeyMap[i]] = arr[i];
                    }
                    resolve(json);
                }).catch(err=> {
                    reject(err);
                });
            } else {
                resolve(data);
            }
        });
    }


    /**
     * get entity json data by id
     * @param {string|number} id entity id
     * @param {object?} queryParam
     * @param {string} queryParam.projection the name of the projection you set with @Projection annotation name attributes
     */
    static findOne(id:string|number, queryParam?:{projection:string}):Promise<Entity> {
        if (id != null) {
            return new Promise((resolve, reject) => {
                request.get(`${this.entityBaseURL()}/${id}`).queryParam(queryParam).send().then(json=> {
                    resolve(this.jsonToEntity(json));
                }).catch((err) => {
                    reject(err);
                })
            });
        } else {
            throw new Error('require id');
        }
    }

    /**
     * collection resource with page and sort.
     * Returns all entities the repository servers through its findAll(…) method. If the repository is a paging repository we include the pagination links if necessary and additional page metadata.*
     * @param {object} queryParam
     * @param {number} queryParam.page the page number to access (0 indexed, defaults to 0).
     * @param {number} queryParam.size the page size requested (defaults to 20).
     * @param {string} queryParam.sort a collection of sort directives in the format ($propertyName,)+[asc|desc]?
     * etc:name,age,desc
     */
    static findAll(queryParam?:{page?:number,size?:number,sort?:string}):Promise<Entity[]> {
        return new Promise((resolve, reject) => {
            request.get(this.entityBaseURL()).queryParam(queryParam).send().then(json => {
                let re = this.jsonToEntityList(json);
                resolve(re);
            }).catch((err) => {
                reject(err);
            });
        });
    }

    /**
     * search resource if the backing repository exposes query methods.
     * call query methods exposed by a repository. The path and name of the query method resources can be modified using @RestResource on the method declaration.
     *
     * @param {string} searchPath spring data rest searchMethod path string
     *
     * @param {Object} queryParam search params
     * If the query method has pagination capabilities (indicated in the URI template pointing to the resource) the resource takes the following parameters:
     * @param {number} queryParam.page the page number to access (0 indexed, defaults to 0).
     * @param {number} queryParam.size the page size requested (defaults to 20).
     * @param {string} queryParam.sort a collection of sort directives in the format ($propertyName,)+[asc|desc]?
     *
     * @returns {Promise} resolve(Entity|Entity[]) reject(Request)
     * resolve:
     *      if response json data has _embedded attr then resolve Entity array,
     *      else resolve one Entity
     */
    static search(searchPath:string, queryParam?:{
        page?:number,
        size?:number,
        sort?:string,
        [key:string]:any
    }):Promise<Entity|Entity[]> {
        return new Promise((resolve, reject) => {
            request.get(`${this.entityBaseURL()}/search/${searchPath}`).queryParam(queryParam).send().then((json) => {
                try {//response entity list
                    resolve(this.jsonToEntityList(json));
                } catch (_) {//response one entity
                    resolve(this.jsonToEntity(json));
                }
            }).catch((err) => {
                reject(err);
            })
        })
    }

    /**
     * remove entity by id
     */
    static remove(id:string|number):Promise<void> {
        return request.deleteMethod(`${this.entityBaseURL()}/${id}`).send();
    }

    /**
     * expose entity instance properties in _data to entity itself use Object.defineProperty getter and setter
     * after expose,you can access property in entity by entity.property rather than access by entity.data().property
     * @param propertyName property name in entity.data() object.
     */
    static exposeProperty(propertyName) {
        Object.defineProperty(this.prototype, propertyName, {
            get: function () {
                return this.get(propertyName);
            },
            set: function (value) {
                this.set(propertyName, value);
            },
            enumerable: true
        })
    }
}

/**
 * build an Entity Entity
 * @param entity_name spring data rest entity path
 */
export function extend(entity_name:string):typeof Entity {

    class Class extends Entity {
    }
    /**
     * spring data rest entity path
     */
    Class.entityName = entity_name;

    return Class;

}



