import type { LibraryBook, StoredPage } from "../shared/library";
import type { Library } from "./library";

/**
 * Finds a book and page the way the midad command names them: a book by its id,
 * the start of one, or part of its title; a page by its position in the book.
 */
export const createPageFinder = ({ library }: { library: Pick<Library, "listBooks" | "getPage"> }) => {
  const findBook = async (query: string): Promise<LibraryBook> => {
    const books = await library.listBooks();
    const exact = books.find((b) => b.bookId === query);
    if (exact) return exact;
    const matches = books.filter((b) => b.bookId.startsWith(query) || b.title.includes(query) || b.edition?.includes(query));
    if (matches.length === 1 && matches[0]) return matches[0];
    if (matches.length === 0) throw new Error(`No book matches "${query}". Run \`midad books\` to see them.`);
    throw new Error(`"${query}" matches ${matches.length} books: ${matches.map((b) => `${b.title} (${b.bookId})`).join(", ")}.`);
  };

  const findPage = async ({ book, position }: { book: string; position: number }): Promise<StoredPage> => {
    const found = await findBook(book);
    const stored = await library.getPage({ bookId: found.bookId, position });
    if (!stored) throw new Error(`${found.title} has no page ${position}; it has ${found.pageCount}.`);
    return stored;
  };

  return { findBook, findPage };
};
