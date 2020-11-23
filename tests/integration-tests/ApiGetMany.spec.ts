import { MakeMockClient } from "./utils/test-helpers";
import { GetMany } from "../../src/providers/queries";

describe("api methods", () => {
  test("FireClient list docs", async () => {
    const client = MakeMockClient();
    const docIds = ["test123", "test22222", "asdads"];
    const collName = "list-mes";
    const collection = client.db().collection(collName);
    await Promise.all(
      docIds.map((id) => collection.doc(id).set({ title: "ee" }))
    );

    const result = await GetMany(
      collName,
      {
        ids: docIds.slice(1),
      },
      client
    );
    expect(result.data.length).toBe(2);
    expect(result.data[0]["id"]).toBe("test22222");
    expect(result.data[1]["id"]).toBe("asdads");
  }, 100000);
});
