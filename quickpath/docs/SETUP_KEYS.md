# Setting up AI in QuickPath

QuickPath works with **no AI at all**. Everything below is optional and adds more.

## What uses AI, and what it costs

| What | Model | Where it runs | Needs a key | Cost |
|---|---|---|---|---|
| Writing the scenes from your idea | A model through **Ollama** (for example `qwen3:8b`) | On your own computer | No | Free |
| Pictures behind your scenes | Google **Imagen 4 Fast**, through **Kie.ai** | Kie.ai's servers | Yes, a Kie.ai key | About $0.02 per picture |
| Voices (20 to choose from) | **ElevenLabs** through **Kie.ai** | Kie.ai's servers | Yes, the same Kie.ai key | About $0.03 per line |
| AI music | **Suno** through **Kie.ai** | Kie.ai's servers | Yes, the same Kie.ai key | About $0.06 per track |
| A picture brought to life | **Wan 2.2 Turbo** through **Kie.ai** | Kie.ai's servers | Yes, the same Kie.ai key | About $0.40 per 5 second clip |
| More natural voiceovers | **OpenAI** speech (`tts-1`) | OpenAI's servers | Yes, an OpenAI key | About $0.002 for a 15 second video |
| Free voiceover | The voices built into Windows (David, Zira) | On your own computer | No | Free |
| Music | Made by QuickPath itself (four moods), or your own file | On your own computer | No | Free |

Nothing paid is ever sent until you press **Confirm** in a window that shows the model, the price and the exact words. QuickPath also stops at a
spending limit (default $5) that you can change in Settings.

## Where to put your keys

1. Open QuickPath.
2. Press the **sliders button** at the top right (or the link under the idea box that says "Add keys for AI pictures and voices"). The **Settings** window opens.
3. Find the provider, paste the key into its box, and press **Save key**.
4. Press **Check it works**. QuickPath asks the provider a free question (your credit balance, or the list of voices) and tells you if the key is accepted.
   Nothing is made or charged by the check.

That is all. You never need a command line.

After you save a key, QuickPath **never shows it again**, not even to you. The window only says "Key set". To replace a key, paste a new one over it.
To delete it, press **Remove**.

## Getting a key

- **Kie.ai:** sign in at kie.ai, open the API Key page, create a key, copy it. Add some credit to your Kie.ai account (a few dollars lasts a long time at two cents a picture).
- **OpenAI:** sign in at platform.openai.com, open API keys, create a key, copy it. Add credit under Billing.

Copy the **whole** key. Spaces before or after it are removed for you. If QuickPath says "That does not look like a key", something was cut off or extra text came with it.

## Where the key is kept, and how it is protected

- On Windows, in **Windows Credential Manager**, under the names `QuickPath/kie` and `QuickPath/openai`. You can see or delete them yourself:
  Start menu, "Credential Manager", Windows Credentials.
- It is sent over a private channel from the Settings window to the QuickPath program on your own computer, then to Windows. It does not travel to anyone else,
  and it is handed to Windows on the standard input, not the command line, so other programs cannot see it.
- It is used only to talk to its own provider (Kie.ai or OpenAI), and never appears in the page, a file, a log or the saved video folders.
- If you already saved a key in the main **MotionCraft** app on this computer, QuickPath can use it as a fallback. Settings says "Using the key saved in MotionCraft".
  QuickPath never changes or deletes MotionCraft's keys.

## Order QuickPath looks for a key

1. A computer setting named `KIE_API_KEY` or `OPENAI_API_KEY` (for people who prefer that).
2. The key saved from Settings.
3. On Windows, the key saved in MotionCraft.

Settings always tells you which one is in use.

## Setting up the model on your computer (optional)

1. Install **Ollama** (ollama.com).
2. Open a terminal once and run `ollama pull qwen3:8b` (about 5 GB, one time). Any text model such as llama3 or mistral also works.
3. Leave Ollama running. Settings shows "Found" next to "Scenes: a model on this computer".

If the model is missing or slow, QuickPath waits up to 25 seconds and then cuts your own sentences into scenes instead. You lose nothing.

## Mac and other systems

Saving keys from the Settings window works on **Windows** for now. On a Mac, set the key as an environment setting before opening QuickPath:
`KIE_API_KEY` and/or `OPENAI_API_KEY`. Settings will show "Set with a computer setting". (The Mac build has never been run on a Mac.)

## Troubleshooting

| You see | What to do |
|---|---|
| "No Kie.ai key was found" when you press Make a picture | Add the key in Settings |
| "The provider did not accept this key" | The key is wrong or expired. Copy it again from your account page and Save |
| "Your Kie.ai account is out of credit" | Add credit in your Kie.ai account |
| "OpenAI says you are out of credit or asking too fast" | Add credit under Billing, or wait a minute |
| "Could not reach the provider" | Check your internet connection |
| "This would pass your spending limit" | Raise the limit in Settings if you want to spend more |
| "Windows did not save the key" | Try again; if it keeps failing, set the `KIE_API_KEY` or `OPENAI_API_KEY` computer setting instead |

## fal

A fal key can be saved and checked in Settings (it is kept as `QuickPath/fal` or in `FAL_KEY`). Nothing uses it yet: Kie.ai already does pictures, voices, music and clips.
