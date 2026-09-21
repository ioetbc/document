"use server";

import { isValidSource } from "./source";

export async function submitSource(source: string) {
  if (!isValidSource(source)) throw new Error("Invalid source");

  const {href} = new URL(source);

  console.log('server action href', href)


  return { source };
}
