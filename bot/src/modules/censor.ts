import { Extension, listener } from "@pikokr/command.ts"
import { codeBlock, Colors, EmbedBuilder, Message } from "discord.js"
import hangul from "hangul-js"
import { prisma, RuleType } from "shared"
import chalk from "chalk"

class CensorModule extends Extension {
  @listener({ event: "messageUpdate" })
  async messageUpdate(oldMsg: Message, newMsg: Message) {
    return this.messageCreate(newMsg)
  }

  @listener({ event: "messageCreate" })
  async messageCreate(msg: Message) {
    if (msg.author.bot || msg.author.id === this.client.user?.id) return
    if (!msg.content) return

    const originalContent = msg.content
      .normalize()
      .replace(/[!?@#$%^&*():;+-=~{}<>_\[\]|\\"',.\/`₩\s\t]/g, "")

    const matches = await prisma.$queryRaw<
      {
        separate: boolean
        id: string
        regex: string
        name: string
        ruleType: RuleType
        ruleId: string
        ruleName: string
      }[]
    >`
    with rule_types
      as (select el."separate",
            el."id",
            el."regex",
            el."name",
            el."ruleType",
            el."ruleId",
            case el."separate"
              when TRUE then ${hangul.disassembleToString(originalContent)}
              else ${originalContent}
            end as  "_Input"
          from   "RuleElement" as el)
        select el.*, el."name" as "ruleName"
        from rule_types el
        right join "Rule" r on el."ruleId" = r."id"
        where (
          ("ruleType" = 'Black' :: "RuleType" and "_Input" ~* "regex") or 
          ("ruleType" = 'White' :: "RuleType" and not "_Input" ~* "regex") ) and exists 
          (select from "__ruleOnChannel" where "A" = ${
            msg.channel.id
          } and "B" = "ruleId"
        ) limit 1;`

    if (!matches.length) return
    if (!msg.deletable) return

    // 규칙을 위반한 메시지 삭제
    await msg.delete()

    const rule = matches[0]

    const regex = new RegExp(rule.regex, "g")

    const normalizedContent = msg.content.normalize()

    const regexMatches = normalizedContent.matchAll(regex)

    let content = ""

    let lastIndex = 0

    // function that remove symbols from the string and korean is not symbol
    // const removeSymbols = (str: string) => {
    //   return str
    //     .replace(
    //       /[^\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF\u0020]/g,
    //       ""
    //     )
    //     .replace(
    //       /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/g,
    //       ""
    //     )
    // }

    for (const match of regexMatches) {
      if (match.index === undefined || match.input === undefined) return

      content += normalizedContent.slice(lastIndex, match.index)

      content += `\u001b[31m${match[0]}\u001b[0m`

      lastIndex = match.index + match[0].length
    }

    content += normalizedContent.slice(lastIndex)

    if (content === normalizedContent) {
      let newContent: string = ""
      const regexMatches2 = originalContent.matchAll(regex)
      for (const match of regexMatches2) {
        if (match.index === undefined || match.input === undefined) return

        newContent += originalContent.slice(lastIndex, match.index)

        newContent += `\u001b[31m${match[0]}\u001b[0m`

        lastIndex = match.index + match[0].length
      }

      if (originalContent !== newContent) {
        newContent += originalContent.slice(lastIndex)
        content += `\n-----------------------------------------------\n→ ${newContent}`
      }
    }

    // 키뮤식 구현
    // const matchContent = msg.content.match(regex)
    // if (matchContent && matchContent.length) {
    //   const regexKimu = new RegExp(`(${rule.regex})`, "g")
    //   content = content.replace(regexKimu, "**$1**")
    //   content = content.replace(/\*{4}/g, "")
    // }

    // 알림 메시지 생성
    // const firstMatchRule = matches[0]
    // const matchStrings = msg.content.match(firstMatchRule.regex)
    // let matchStr: string | null = null
    // if (matchStrings && matchStrings.length) {
    //   matchStr = matchStrings[0]
    // }

    const alertEmbed = new EmbedBuilder()
      .setAuthor({
        iconURL: msg.author.displayAvatarURL(),
        name: msg.author.tag,
      })
      .setTimestamp()

    alertEmbed.setDescription(codeBlock("ansi", content))
    alertEmbed
      .setFooter({
        text: `\`${rule.ruleName}\`을(를) ${
          rule.ruleType === "Black" ? "말했습니다." : "말하지 않았습니다."
        }`,
      })
      .setColor(Colors.Red)

    // 해당 서버의 알림 채널 정보 불러옴
    // const channelData = await prisma.$queryRaw<
    //   {
    //     alertChannelId: string
    //   }[]
    //   >`SELECT alertChannelId FROM "Channel" WHERE "id" = ${msg.channel.id};`
    // if(!channelData.length) return
    // const alertChannelId = channelData[0].alertChannelId

    await msg.channel.send(
      {
        content: `${msg.author}님이 ${msg.channel}에서 \`${rule.ruleName}\` 규칙을 위반하셨습니다.`,
        embeds: [alertEmbed],
      }
      // codeBlock("diff", matches.map((x) => `- ${x.ruleName}`).join("\n"))
    )
  }
}

export const setup = () => {
  return new CensorModule()
}
