const core = require('@actions/core')
const http = require('@actions/http-client')

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function tailDeployStatus(client, url, appName, secretKey, deploymentId) {
  let status = null
  let cursor = 0

  while (status === null) {
    url.searchParams.set('action', 'deploymentStatus')
    const response = await client.post(
      url.toString(),
      JSON.stringify({
        appName,
        secretKey,
        deploymentId,
        cursor
      })
    )

    const lines = (await response.readBody()).split('\n')

    if (lines.trim().length === 0) {
      core.warning('tail: no logs, skipping sorry :/')
      return
    }

    for (const line of lines) {
      core.debug(`tail: recv ${line}`)
      let nextCursor, rawEntry, entry
      try {
        ;[nextCursor, rawEntry] = JSON.parse(line)
        entry = JSON.parse(rawEntry)
      } catch (e) {
        core.warning(`tail: failed to parse ${line}`)
        return
      }

      if (['err', 'omg'].includes(entry.type)) {
        core.error(entry.msg.trim())
      } else if (entry.type === 'inf') {
        core.info(entry.msg.trim())
      } else if (entry.type === 'wrn') {
        core.warning(entry.msg.trim())
      } else if (entry.type === 'DED') {
        core.error(entry.msg.trim())
        core.setFailed(entry.msg.trim())
        status = 'fail'
        break
      } else if (entry.type === 'OKI') {
        core.info(entry.msg.trim())
        status = 'ok'
        break
      }

      core.debug(`tail: cursor will be ${nextCursor}`)
      cursor = nextCursor
    }

    await sleep(1000)
  }
}

async function run() {
  const secretKey = core.getInput('secretKey', {
    required: true,
    trimWhitespace: true
  })
  const appName = core.getInput('appName', {
    required: true,
    trimWhitespace: true
  })
  const baseUrl = core.getInput('url', { required: true, trimWhitespace: true })
  const url = new URL(baseUrl)
  url.searchParams.set('action', 'deploy')

  const client = new http.HttpClient('devil-deployer-companion-action/main')

  core.debug(`connecting to ${baseUrl}`)
  const response = await client.postJson(url.toString(), {
    appName,
    secretKey
  })
  core.debug(
    `deployment id is ${response.result.deploymentId}, starting to tail the deployment status`
  )
  await tailDeployStatus(
    client,
    url,
    appName,
    secretKey,
    response.result.deploymentId
  )
  core.debug(`deployment id is ${response.result.deploymentId}, done`)
  url.searchParams.set('action', 'clearDeployment')
  core.debug(`deployment id ${response.result.deploymentId} will be cleared`)
  await client.postJson(url.toString(), {
    appName,
    secretKey,
    deploymentId: response.result.deploymentId
  })
  core.debug(`deployment id ${response.result.deploymentId} cleared`)
}

module.exports = {
  run
}
