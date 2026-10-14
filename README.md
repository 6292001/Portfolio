# Thumbnail portfolio (with its own admin)

Your site and a private admin page that works on its own, with no Claude needed.

- **Your website:** `yoursite.com`
- **Your admin:** `yoursite.com/admin` (not linked anywhere). Tap the big headline 5 times quickly, or type the letters `admin`, to jump there.

In the admin you can add, remove and reorder thumbnails, pick up to 20 for "Selected work", change colors, and edit the top headline (Hero tab), the About me section and photo, the How to start cards, the FAQ, your photo and stats.
Press **Save changes** and your live website updates instantly. No redeploy.

---

## Deploy on Netlify (easiest, no extra accounts)

1. Put this folder on GitHub: create a free repository, then use **Add file > Upload files** and drag in everything from this folder (keep the folders as they are).
2. On netlify.com: **Add new site > Import an existing project > GitHub**, pick your repository, and press **Deploy**. Netlify reads `netlify.toml`, so there is nothing to configure.
3. Open **Site configuration > Environment variables > Add a variable**:
   - Key: `ADMIN_PASSWORD`
   - Value: the password you want (long and unique)
4. Go to **Deploys > Trigger deploy > Deploy site** so the password is picked up.
5. Open `yoursite.netlify.app/admin`, sign in, press **Import my existing thumbnails**, and you're done.

Images and data are stored in Netlify Blobs, which is built in and free for this use.

## Deploy on Vercel

1. Put the folder on GitHub (same as above), then on vercel.com choose **Add New > Project** and import the repository. Press **Deploy**.
2. In the project open the **Storage** tab > **Create Database** > **Upstash Redis** (free plan is fine) > connect it to the project. Vercel adds the connection variables for you.
3. Open **Settings > Environment Variables** and add `ADMIN_PASSWORD` with your password.
4. **Deployments > Redeploy** (so the variables are used).
5. Open `yoursite.vercel.app/admin`, sign in, press **Import my existing thumbnails**.

## Try it on your computer first (optional)

```
npm install
ADMIN_PASSWORD=choose-a-password npm run dev
```
Then open http://localhost:8787 and http://localhost:8787/admin. (Data is saved in a `.data` folder.)

---

## Good to know

- **After importing**, you can delete the `public/seed` folder from your repository. It only holds your starting content.
- **Changing your password:** edit the `ADMIN_PASSWORD` variable in Netlify/Vercel and redeploy.
- **Security:** the password lives only on the server (never in the website's code). Sign-in sets a private cookie for 7 days; 5 wrong tries lock that device out for 15 minutes; uploads are checked to be real JPEG images and are limited in size. Use a long, unique password. You can also add a `SESSION_SECRET` variable (any long random text) for extra strength.
- **Images** are shrunk in your browser before upload, so pages stay fast. Up to 200 thumbnails.
- If the admin page says **"Storage isn't connected yet"** on Vercel, step 2 above is missing. If it says **"Set your admin password"**, steps 3-4 are missing.
