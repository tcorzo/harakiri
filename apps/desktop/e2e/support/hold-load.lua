-- Holds mpv's file load until the test writes `release` into the app's mpv config dir (`~~/`),
-- so a test can act, deterministically, between the handoff's Picture station and mpv taking the file.
local release = mp.command_native({ "expand-path", "~~/release" })

mp.add_hook("on_load", 50, function(hook)
  hook:defer()
  local timer
  timer = mp.add_periodic_timer(0.05, function()
    local file = io.open(release, "r")
    if file then
      file:close()
      timer:kill()
      hook:cont()
    end
  end)
end)
