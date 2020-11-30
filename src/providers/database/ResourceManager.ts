// Firebase types
import {
  CollectionReference,
  QueryDocumentSnapshot,
  FirebaseFirestore,
} from "@firebase/firestore-types";
import { RAFirebaseOptions } from "../RAFirebaseOptions";
import { IFirebaseWrapper } from "./firebase/IFirebaseWrapper";
import { User } from "@firebase/auth-types";
import {
  log,
  getAbsolutePath,
  messageTypes,
  logError,
  parseAllDatesDoc,
  logWarn,
} from "../../misc";

export type DocumentData = { [field: string]: any };

export interface IResource {
  path: string;
  pathAbsolute: string;
  collection: CollectionReference;
  list: Array<{} & { deleted?: boolean }>;
}

export class ResourceManager {
  private resources: {
    [resourceName: string]: IResource;
  } = {};

  private db: FirebaseFirestore;

  constructor(
    private fireWrapper: IFirebaseWrapper,
    private options: RAFirebaseOptions
  ) {
    this.db = fireWrapper.db();

    this.fireWrapper.OnUserLogout((user) => {
      this.resources = {};
    });
  }

  public async TryGetResource(
    resourceName: string,
    refresh?: "REFRESH",
    collectionQuery?: messageTypes.CollectionQueryType
  ): Promise<IResource> {
    if (refresh) {
      await this.RefreshResource(resourceName, collectionQuery);
    }
    return this.TryGetResourcePromise(resourceName, collectionQuery);
  }

  public GetResource(relativePath: string): IResource {
    const resource: IResource = this.resources[relativePath];
    if (!resource) {
      throw new Error(
        `react-admin-firebase: Cant find resource: "${relativePath}"`
      );
    }
    return resource;
  }

  public async TryGetResourcePromise(
    relativePath: string,
    collectionQuery?: messageTypes.CollectionQueryType
  ): Promise<IResource> {
    log("resourceManager.TryGetResourcePromise", {
      relativePath,
      collectionQuery,
    });
    await this.initPath(relativePath, collectionQuery);

    const resource: IResource = this.resources[relativePath];
    if (!resource) {
      throw new Error(
        `react-admin-firebase: Cant find resource: "${relativePath}"`
      );
    }
    return resource;
  }


  public async RefreshResource(
    relativePath: string,
    collectionQuery: messageTypes.CollectionQueryType | undefined
  ) {
    log("resourceManager.RefreshResource", { relativePath, collectionQuery });
    await this.initPath(relativePath, collectionQuery);
    const resource = this.resources[relativePath];

    const collection = resource.collection;
    const query = this.applyQuery(collection, collectionQuery);
    const newDocs = await query.get();
    // resource.list = newDocs.docs.map((doc) => this.parseFireStoreDocument(doc));

    resource.list = await Promise.all(newDocs.docs.map(async (doc) => {
      const data = this.parseFireStoreDocument(doc)
      for (let key in data){
        if(key.endsWith('_id')){
          const relativePath: string = key.replace('_id','') || ''
          if (data[key]){
            const newData = await this.GetSingleDoc(relativePath, data[key]);
            const assinged = {
              [relativePath]: newData
            }
            Object.assign(data, assinged);
            log("resourceManager.RefreshResource - subfetch", { data, refId: data[key], refDoc: data[relativePath], key })
        
          }
        }
      }
      return data
    }));

    log("resourceManager.RefreshResource", {
      newDocs,
      resource,
      collectionPath: collection.path,
    });
  }

  public async GetSingleDoc(relativePath: string, docId: string) {
    await this.initPath(relativePath);
    const resource = this.resources[relativePath];
    const docSnap = await resource.collection.doc(docId).get();
    if (!docSnap.exists) {
      // return;
      throw new Error("react-admin-firebase: No id found matching: " + relativePath + "/" + docId);
    }
    const result = this.parseFireStoreDocument(docSnap as any);
    await Promise.all(Object.keys(result).map(async (key: string) => {
    // for (let key in result){
      if(key.endsWith('_id')){
        const relativePath: string = key.replace('_id','') || ''
        if (result[key]){
          const newData = await this.GetSingleDoc(relativePath, result[key]);
          const assinged = {
            [relativePath]: newData
          }
          Object.assign(result, assinged);
          log("resourceManager.GetSingleDoc - subfetch", { newData, refId: result[key], refDoc: relativePath, key })
        }
      }
    // }
    return result
  }));
    log("resourceManager.GetSingleDoc", {
      relativePath,
      resource,
      docId,
      docSnap,
      result,
    });
    return result;
  }

  private async initPath(
    relativePath: string,
    collectionQuery?: messageTypes.CollectionQueryType
  ): Promise<void> {
    const rootRef = this.options && this.options.rootRef;
    const absolutePath = getAbsolutePath(rootRef, relativePath);
    const hasBeenInited = !!this.resources[relativePath];
    log("resourceManager.initPath()", {
      absolutePath,
      hasBeenInited,
    });
    if (hasBeenInited) {
      log("resourceManager.initPath() has been initialized already...");
      return;
    }
    const collection = this.db.collection(absolutePath);
    const list: Array<{}> = [];
    const resource: IResource = {
      collection: collection,
      list: list,
      path: relativePath,
      pathAbsolute: absolutePath,
    };
    this.resources[relativePath] = resource;
    log("resourceManager.initPath() setting resource...", {
      resource,
      allResources: this.resources,
      collection: collection,
      collectionPath: collection.path,
    });
  }

  private parseFireStoreDocument(doc: QueryDocumentSnapshot | undefined): any {
    if (!doc) {
      logWarn("parseFireStoreDocument: no doc", { doc });
      return {};
    }
    const data = doc.data();
    parseAllDatesDoc(data);
    // React Admin requires an id field on every document,
    // So we can just using the firestore document id
    return { id: doc.id, ...data };
  }

  public async getUserIdentifier(): Promise<string> {
    const identifier = this.options.associateUsersById
      ? await this.getCurrentUserId()
      : await this.getCurrentUserEmail();
    return identifier;
  }

  private async getCurrentUserEmail() {
    const user = await this.fireWrapper.GetUserLogin();
    if (user) {
      return user.email as string;
    } else {
      return "annonymous user";
    }
  }
  private async getCurrentUserId() {
    const user = await this.fireWrapper.GetUserLogin();
    if (user) {
      return user.uid;
    } else {
      return "annonymous user";
    }
  }

  private removeResource(resourceName: string) {
    delete this.resources[resourceName];
  }

  private applyQuery(
    collection: CollectionReference,
    collectionQuery?: messageTypes.CollectionQueryType
  ): CollectionReference {
    let collref: CollectionReference;
    if (collectionQuery) {
      collref = collectionQuery(collection);
    } else {
      collref = collection;
    }
    log("resourceManager.applyQuery() ...", {
      collection,
      collectionQuery: (collectionQuery || "-").toString(),
      collref,
    });
    return collref;
  }
}
