// Who may use the chat: only someone whose GitHub sign-in can write to the site's repo.
// The repo is public and anyone can sign in through the GitHub App, so a valid token and a
// 200 from GitHub prove nothing. The answer has to say push access in so many words.

export function hasPush(repo) {
  return repo?.permissions?.push === true;
}

export async function canPush(token, repoName) {
  if (!token) return false;
  let response;
  try {
    response = await fetch(`https://api.github.com/repos/${repoName}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "crabbe-construction-chat",
      },
    });
  } catch {
    return false;
  }
  if (!response.ok) return false;
  try {
    return hasPush(await response.json());
  } catch {
    return false;
  }
}
