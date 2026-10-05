import {
  applyPhotoChange,
  getMyPhoto,
  listMyPhotos,
  signPhotoImages,
  signThumbnails,
  subscribeToMyPhotos,
  type PhotoChange,
} from '@/lib/photos';
import { OTHER_USER_ID, USER_ID, fakeSupabase, makePhoto } from '@/test-utils/fakeSupabase';

const mine = makePhoto({ id: 'aaaaaaaa-0000-4000-8000-000000000001' });
const theirs = makePhoto({ id: 'aaaaaaaa-0000-4000-8000-000000000002', user_id: OTHER_USER_ID });

describe('listMyPhotos', () => {
  it("filters on the User's id rather than relying on RLS alone", async () => {
    const supabase = fakeSupabase([mine, theirs]);
    await expect(listMyPhotos(supabase.client, USER_ID)).resolves.toEqual([mine]);
    expect(supabase.filters[0]).toEqual([['user_id', USER_ID]]);
  });
});

describe('getMyPhoto', () => {
  it("returns the User's own photo", async () => {
    const supabase = fakeSupabase([mine]);
    await expect(getMyPhoto(supabase.client, USER_ID, mine.id)).resolves.toEqual(mine);
  });

  it("never returns someone else's photo", async () => {
    const supabase = fakeSupabase([theirs]);
    await expect(getMyPhoto(supabase.client, USER_ID, theirs.id)).resolves.toBeNull();
    expect(supabase.filters[0]).toContainEqual(['user_id', USER_ID]);
  });

  it('treats a malformed id as not found without querying', async () => {
    const supabase = fakeSupabase([mine]);
    await expect(getMyPhoto(supabase.client, USER_ID, 'not-a-uuid')).resolves.toBeNull();
    expect(supabase.filters).toHaveLength(0);
  });
});

describe('signing image URLs', () => {
  const completed = makePhoto({
    id: 'aaaaaaaa-0000-4000-8000-000000000003',
    status: 'completed',
    processed_path: `${USER_ID}/aaaaaaaa-0000-4000-8000-000000000003.png`,
  });

  it('uses the Enhanced Image as thumbnail once completed, else the Original', async () => {
    const supabase = fakeSupabase();
    const urls = await signThumbnails(supabase.client, USER_ID, [mine, completed]);
    expect(urls).toEqual({
      [mine.id]: `https://signed.test/images/${mine.original_path}`,
      [completed.id]: `https://signed.test/processedimages/${completed.processed_path}`,
    });
  });

  it("refuses to sign paths outside the User's folder", async () => {
    const supabase = fakeSupabase();
    const stray = makePhoto({ original_path: `${OTHER_USER_ID}/x.jpg` });
    await expect(signThumbnails(supabase.client, USER_ID, [stray])).resolves.toEqual({});
    expect(supabase.signed).toEqual([]);
  });

  it('signs both images of a completed photo', async () => {
    const supabase = fakeSupabase();
    await expect(signPhotoImages(supabase.client, USER_ID, completed)).resolves.toEqual({
      original: `https://signed.test/images/${completed.original_path}`,
      enhanced: `https://signed.test/processedimages/${completed.processed_path}`,
    });
  });

  it('has no Enhanced Image before completion', async () => {
    const supabase = fakeSupabase();
    const images = await signPhotoImages(supabase.client, USER_ID, mine);
    expect(images.enhanced).toBeNull();
    expect(supabase.signed.map((s) => s.bucket)).toEqual(['images']);
  });
});

describe('applyPhotoChange', () => {
  const change = (eventType: PhotoChange['eventType'], row: object, old: object = {}) =>
    ({ eventType, new: row, old }) as PhotoChange;

  it('prepends a new photo', () => {
    const fresh = makePhoto({ id: 'aaaaaaaa-0000-4000-8000-000000000009' });
    expect(applyPhotoChange([mine], USER_ID, change('INSERT', fresh))).toEqual([fresh, mine]);
  });

  it('updates a photo status in place', () => {
    const done = { ...mine, status: 'completed' as const };
    expect(applyPhotoChange([mine], USER_ID, change('UPDATE', done))).toEqual([done]);
  });

  it('ignores updates to photos it does not show, and other Users', () => {
    expect(applyPhotoChange([mine], USER_ID, change('UPDATE', theirs))).toEqual([mine]);
    expect(applyPhotoChange([], USER_ID, change('INSERT', theirs))).toEqual([]);
  });

  it('removes a deleted photo', () => {
    expect(applyPhotoChange([mine], USER_ID, change('DELETE', {}, { id: mine.id }))).toEqual([]);
  });
});

describe('subscribeToMyPhotos', () => {
  it("listens to the User's photos rows only, and unsubscribes", () => {
    const supabase = fakeSupabase();
    const onChange = jest.fn();
    const onSubscribed = jest.fn();
    const unsubscribe = subscribeToMyPhotos(supabase.client, USER_ID, onChange, onSubscribed);

    expect(supabase.channelFilters).toEqual([
      { event: '*', schema: 'public', table: 'photos', filter: `user_id=eq.${USER_ID}` },
    ]);
    supabase.connect();
    expect(onSubscribed).toHaveBeenCalled();
    supabase.emit({ eventType: 'UPDATE', new: mine });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ new: mine }));

    unsubscribe();
    expect(supabase.client.removeChannel).toHaveBeenCalled();
  });
});
