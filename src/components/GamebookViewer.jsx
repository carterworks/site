import "@xyflow/react/dist/style.css";
import "./gamebook-viewer.css";

import { toPng } from "html-to-image";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  Background,
  Controls,
  getNodesBounds,
  getViewportForBounds,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
} from "@xyflow/react";

const elk = new ELK();

const DEFAULT_CHOICES = String.raw`1. You, Neil Patrick Harris, are born in Albuquerque, New Mexico, on June 15, 1973, at what you're pretty sure is St. Joseph's Hospital, although it's har...
A(3). If you would like to experience a happy childhood, go HERE .
B(2). If you would prefer to experience a miserable childhood that later in life you can claim to have heroically overcome, go HERE .

2. You, Neil Patrick Harris, are born in Albuquerque, New Mexico, on June 15, 1973. You're pretty sure it's in the backseat of a taxicab, but you can't be...
A(3). If you would like to experience a more wholesome childhood, go HERE .
B(94). If you are eager to meet your own children, skip ahead thirty years and go HERE .

3. Your parents live in Ruidoso, a beautiful mountain town of around five thousand people perched over a mile up in the Sierra Blanca range of south-central New...
A(5). If you want to begin exploring the world of theater, go HERE .
B(8). If you want to start learning magic, go HERE .
C(4). If you want to spend waaaaay too many hours practicing the Optimist Club speech in front of a bathroom mirror, go to the bathroom, press HERE and start reciting.

4. Optimism: A Way of Life An Award-Winning Speech by Neil Patrick Harris, Age 13
A(5). If, having practiced this speech to within an inch of your/its life, you feel ready to begin exploring the world of acting, go HERE .
B(6). If, having practiced this speech to within an inch of your/its life, you feel ready to audition for your first movie role, go HERE .
C(76). If, having practiced this speech to within an inch of your/its life, you feel ready to host a major televised awards show, go HERE .
D(23). If, having practiced this speech to within an inch of your/its life, you are so imbued with optimism you are ready to stare down a crazed young actor outside a Los Angeles nightclub, go HERE .

5. Annie is great. The Best Little Whorehouse in Texas is great. But it's Les Miserables that first opens up your adolescent soul to the glorious alternate u...
A(6). To begin pursuing your love of acting in a way that might just possibly lead to your big break, go HERE .
B(28). To finally get your chance to star onstage in a major production, go HERE .
C(10). You know, a lot of young boys who are into theater turn out to be ... umm ... you know, why don't you just go HERE .

6. It's the spring of 1986. In the wake of your star turn in How the West Was Really Won, your budding love of performance is in full bloom. Mr. Cook, the cho...
A(12). If you go to the room on the left, go HERE .
B(7). If you go to the room on the right, go HERE .

7. "I said smoked turkey, not regular turkey, jackass!!!" The customer's angry shout jerks you back from fantasy to reality.
A(7). End.

8. You are five years old. You are hanging out with your mom's dad, your beloved Grandpa Scott. He hands you a match, a cork, a needle, a clear plastic cup, a...
A(15). If you would like to pursue magic as a hobby despite this fiasco, go HERE .
B(11). If you would like to pursue magic as a career despite this fiasco, go HERE .
C(16). If you'd like to perform an actual magic trick right here right now, go HERE .
D(19). If you're entirely through with magic and would rather focus on acting, go HERE .

9. And now a word from your friend ...
A(32). If you're feeling magical now that Penn Jillette is your friend, go HERE .
B(29). If you're feeling horny now that Penn Jillette has made you gay, go HERE .
C(28). If you're feeling musical theatery now that Penn Jillette has played Sondheim for you, go HERE .

10. From early in life you are drawn to guys in a tingly kind of way. In elementary school you have a crush (if one could call it that) on the trumpet player in ...
A(19). To get famous, go HERE .
B(29). To get laid, go HERE .

11. "And now I, Neil the Magnificent, shall attempt the most amazing trick ever conceived in the history of prestidigitation!"
A(11). End.

12. You are a thirteen-year-old boy at a summer theater camp in Las Cruces, New Mexico. You are starting a class in cold-reading auditions, and your teacher is r...
A(13). To bask a little more in the happiness of making Clara's Heart, and to hear from an old friend, go HERE .
B(17). To star in your next movie, this one receiving a cavalcade of negative reviews both unanimous and deserved, go HERE .

13. And now a word from your friend ...
A(17). For a less happy memory from the following year, go HERE .
B(94). To meet your own two cute kids, go HERE .

14. This marks the end of your professional magic career. But your passion for magic never wanes, and when you achieve fame, and the LA club scene rapidly disill...
A(9). To spend more time in Penn Jillette's apartment, go HERE .
B(15). If you're not ready for that kind of intimacy with Penn Jillette, go HERE .

15. Alas, your acting career doesn't leave you with enough time or focus to practice magic enough to actively perform it. Your performances end up relegated mo...
A(58). If you would like to pursue this cunningly teased opportunity, go HERE .
B(59). If you would like to take part in another life-changing magic trick, go HERE .

16. And now, in a never-before-attempted bit of meta-metaphysical wizardry, the real Neil Patrick Harris will reappear to bedazzle you with a magic trick. And by...
A(32). If you'd like to take part in another magic trick, go HERE .
B(19). If not, go HERE .

17. It's 1988, and you are in the director's trailer on the set of a film based on the old novelty song "Purple People Eater" starring you, Ned Beatty, L...
A(19). If you're ready to appear in a creatively and commercial successful piece of entertainment, go HERE .
B(83). If you're ready to appear in a better class of kids' movie, go HERE .
C(43). If you're ready for a vacation, age twenty years, go HERE .

18. Cocktail interlude: How I Wet Your Mother.
A(35). Return to the first prior page.
B(41). Return to the second prior page.
C(58). Return to the third prior page.
D(22). Keep the cocktail party going.

19. After your first film role and a few supporting parts on TV shows, you are utterly addicted to acting. It's something you want to do as much as you possibl...
A(22). To attempt to enjoy the perks of being a child star, only to discover yourself pretty much constitutionally incapable of doing so, go HERE .
B(33). To do more TV acting, go HERE .
C(20). To hear from the creator of Doogie Howser, go HERE .

20. And now a word from your friend ...
A(21). Go HERE .

21. At the end of every episode of Doogie Howser, M.D., Doogie types a few sentences into the journal he keeps on his computer. Most of the time the entries are ...
A(26). Sometimes I wish I could just go away to a different place where I don't have to be Doogie Howser anymore. I'm specifically thinking of HERE .
B(66). Other times I wish I weren't such a nice guy. Instead of being a nice doctor, I'd like to be an evil, horrible doctor, somewhere far away, like HERE .
C(89). And other times I wish I could hang out with Katy Perry at the Super Bowl, but I'll never get to do that, because that's in Indianapolis and to get there I would have to travel all the way HERE .

22. There comes a moment in every young actor's life when he is no longer a child. And according to the laws of California, that moment falls exactly on your s...
A(10). To delve more into the tenuous netherworld that is your adolescent sexuality, go HERE .
B(23). If you prefer to keep those kind of issues hovering in your subconscious for now, go HERE .

23. For all this you still enjoy hanging out with your friends and watching the night unfold from a distance, laughing at yourself for the way you spend night af...
A(25). If your response to Scott Caan is "I'm going to do to your face what cancer did to your dad's body in Brian's Song," go HERE .
B(24). If your response to Scott Caan is "I don't know, Scott, what is up with the West Side?" go HERE .

24. In an alternate universe this is where Scott Caan takes a swing at you. In the actual universe, this is where Scott Caan begins acting like he desperately wa...
A(41). If you are ready to deal with another mercurial actor over a longer period of time, go HERE .
B(26). If you would like to put the Doogie period in general, and Scott Caan in particular, behind you, go HERE .
C(54). If you would like to learn a cocktail recipe far tastier than the vodka cranberries you'd been drinking just before meeting Scott Caan, go HERE .

25. Scott Caan does to your body what his father did to Carlo's body in The Godfather.
A(25). End.

26. Doogie Howser, M.D. ends in 1993, as do your teens. Together in life, together in death.
A(33). To re-experience the wonder that is the made-for-television movie, go HERE .
B(36). To attempt to embark on a stage career, go HERE .
C(45). To return to LA and make another push to star on the big screen, go HERE .

27. Over the decades you guest-star on episodes of more than a dozen different TV sitcoms and dramas. Without exception, each one is very special.
A(85). To work with Sesame Street again, go HERE .
B(77). If you are really enjoying making short appearances on a variety of different TV shows, go HERE .
C(28). If you yearn for the legitimacy of stage work, or are just jonesin' for some hot manlove, go HERE .

28. Despite your love for the stage you are far too busy rescuing patients from a variety of camera-ready ailments to appear on it. But when Doc Howser hangs up ...
A(29). If you want to hook up with a dude, go HERE .
B(93). If you want to rock out onstage even harder and more transgressively, go HERE .
C(36). If you're not ready for that yet, but are still interested in pursuing a life in theater and/or learning titillating gossip about Kelsey Grammer, go HERE .
D(38). If this whole thing is getting too gay for you, snort a line of coke off a stripper's ass HERE .

29. Here's a peculiar and rather disappointing fact about you: you're not much good at remembering the intimate details of your sexual history. To be honest,...
A(39). If you're ready for it to be better, go HERE .
B(61). If you're ready for it to be easier, go HERE .
C(34). If you're ready for neither and this whole thing is giving you gay anxiety, go HERE .

30. Dr. Horrible is one of the greatest and most satisfying experiences of your professional life. So when Joss Whedon calls you out of the blue to say he wants ...
A(30). End.

32. Once again, the real Neil Patrick Harris.
A(59). If you'd like to take part in another magic trick, go HERE .
B(39). If you'd like to feel enchanted in a more romantic way, go HERE .
C(87). Or, check out the chapter starting HERE . It doesn't really flow from this chapter but it's really cool. There's, like, a yacht and everything.

33. Between 1988 and 2001 you star in thirteen made-for-TV movies. You appear in so many that after a while you begin making up new ones in your mind for your ow...
A(48). Get cast in How I Met Your Mother.
B(87). Hang out with Sir Elton John.
C(38). Meet Harold and Kumar.

34. WHEN WE HERE AT TOTALLY STRAIGHT GUY MAGAZINE WERE TOLD NEIL PATRICK HARRIS WAS INTERESTED IN SITTING DOWN FOR AN INTERVIEW, WE WERE SO EXCITED WE ALMOST SPI...
A(39). If you've had enough of this interview and want to go meet the aforementioned man-on-man sex partner of your dreams, go HERE .
B(51). If you want to hear from Barney Stinson himself, go HERE .

35. Congratulations! You have found the hidden page. No other section leads to this one, and it's impossible to imagine anyone violating this book's explicit...
A(18). Relax with the first drink option.
B(54). Relax with the second drink option.

36. Rent gets you a lot of action, and not just offstage. It raises your standing in the theater community, and shortly thereafter Dan Sullivan, one of America's...
A(56). To work with Stephen Sondheim again, go HERE .
B(41). To continue your theater career in a less illustrious way, go HERE .
C(55). To go to Ireland, 'cause why the hell not, go HERE .

37. Have courage, Neil. Don't be scared. Life is an adventure.
A(43). Go back to the vacation choice.
B(62). Go back to the coming-out choice.
C(69). Go back to the family choice.

38. Two of the most important people you meet in your post-Doogie life turn out to be a couple of stoner dudes from Jersey. Not that you set out to meet them. Or...
A(34). Woohoo! To be the subject of a profile in Totally Straight Guy magazine 'cuz you're so totally straight, go HERE .
B(92). To go out on a date with the kind of hot chick a raging heterosexual man like you can get anytime he wants, go HERE .
C(73). If all this adrenaline has you ready for a climactic car chase, go HERE . (It's a gay car chase, though.)

39. Relationship paths involving David.
A(43). To take a vacation with David, go HERE .
B(61). To tell the world you love David, go HERE .
C(70). To start a family with David, go HERE .
D(81). To sing a song with lyrics by a different guy named David, go HERE .

40. FRESH PASTA WITH BOLOGNESE SAUCE
A(88). To tweet food porn about this delicious meal, go HERE .
B(78). To share a meal with one of your best friends, Kelly Ripa, go HERE .
C(95). To bask even more deliciously in David's love, go HERE .

41. In 2002 you are hungry for a starring role on Broadway, and you think you may have found one in Proof, David Auburn's beautifully written Pulitzer Prize ...
A(18). If you need a drink to calm down, go HERE .
B(52). If you need to wake your brain back up, go HERE .
C(47). To continue your stage career, willkommen/bienvenue/welcome im/au/to HERE .
D(45). To attempt to relaunch your movie career, go HERE .

42. And now a word from your friend ...
A(27). Amy is so awesome. It's too bad you won't get to work with her on any of the very special TV guest spots you are now going to do HERE .
B(84). Or in any of the kids' movies HERE .

43. You and your boyfriend, David, are in the middle of a Costa Rican vacation. You spend the first few days in an honest- to-God tree house, a fifty-foot-high ...
A(37). If you decide not to go, turn HERE .
B(44). If you decide to go, keep reading HERE .

44. You and David are both very excited to climb up to the zip-line platforms. One or both of you may or may not also be excited about the possibility that one o...
A(55). To go on another vacation with David, go HERE .
B(95). To experience the coolest vacation/birthday present in the history of mankind, courtesy of David, go HERE .

45. It's been nearly ten years since you appeared on the big screen in Purple People Eater, the movie that was incredibly successful and made you a mega-supers...
A(38). To learn how your hard-core drug use affected two cheeseburger-seeking New Jerseyites, go HERE .
B(3). To go back to a simpler, happier, drug-freer time, go HERE .
C(46). To be the biggest movie star in the world, go HERE .

46. In 1997 your life changes forever when you, Neil Patrick Harris, are cast as Jack Dawson in Titanic.
A(7). Go HERE .

47. It's 2003 and you're stepping into the boots Alan Cumming once wore as the emcee in the Sam Mendes/Rob Marshall directed Broadway production of Cabaret...
A(68). Try to squeeze theater work around How I Met Your Mother.
B(48). Skip extra theater work and return to HIMYM.
C(52). Take a break with a crossword puzzle.

48. Int., Living room. The year 2030.
A(48). End.

50. We now return to How I Became a Bro, already in progress.
A(51). To hear from Barney Stinson, go HERE .
B(60). To kill someone, go HERE .

51. And now a few words from ...
A(95). If, despite Barney's perpetual youth, you want to get older, go HERE .
B(29). If, despite Barney's lady-killer status, you want to get gay, go HERE .

52. The cryptic clues below all refer to your life. They are in random order. Solve them (the number tells you how many letters in the answer), and figure out wh...
A(52). End.

53. Perez Hilton reflects on Neil years later.
A(62). Return HERE .

54. Cocktail recipe chapter.
A(66). Or, to star in the musical for which this drink was named go HERE .

55. You and David are taking a hiking trip in northwest Ireland. You hike to the famous Giant's Causeway, which you reflect looks like something out of Myst be...
A(95). Freaky, right? Anyway, go HERE . What? Sometimes in life you don't get a choice.

56. Sweeney Todd is one of the greatest and most satisfying experiences of your professional life. So when Stephen Sondheim calls you out of the blue to say he w...
A(56). End.

58. Tucked away in Hollywood is a mansion called the Magic Castle. It was once a private residence, but in the 1960s brothers Bill and Milt Larsen decided to tur...
A(84). If all this talk about magic is making you want to do some for real, on live TV, in the middle of a freakin' awards show, go HERE .
B(18). If all this talk about magic is making you thirsty, go HERE .
C(61). If all this talk about magic is making you horny, go HERE .

59. And now, more of the literary magical stylings of the actual NPH.
A(80). If you'd like to take part in another magic trick, go HERE .
B(40). Unless you're hungry, in which case go HERE .

60. On the evening of September 22, 2012, you, Neil Patrick Harris, feel a sudden, overwhelming urge to commit murder.
A(60). End.

61. You are gay.
A(53). For reflections from an older, wiser Perez Hilton, go HERE .
B(62). To continue the happy, wonderful process of publicly coming out, go HERE .

62. At the time, that is what Perez believes. You emphatically do not believe it. You believe the coming-out process is a highly individual one wrought with all ...
A(37). If you choose not to come out, go HERE .
B(64). If you choose to come out in a rational, controlled way that allows your career to continue and thrive, go HERE .
C(65). If you choose to come out in a reckless, over-the-top way that justifiably destroys your career, go HERE .

63. Congratulations! If you are seeing these words while hearing them read out loud, you are attending a promotional event and reading along as I speak them. (No...
A(63). End.

64. You call your manager, Booh Schut, and your agent, Steve Dottenville. You release the publicist who may or may not have gotten you into this mess to begin wi...
A(77). To dish about Oprah, along with the many other talk-show hosts whose shows you have appeared on, go HERE .
B(70). To take the next step toward building a family, go HERE .

65. It's just about 5:30 PST. You stand backstage awaiting your big moment.
A(65). End.

66. It's 2007, and America's television and movie writers are on strike. No one is making scripted entertainment anymore. Mirth is dead. A drama-hungry, come...
A(30). To work with Joss Whedon again, go HERE .
B(88). For more fun on the interwebnet.com, go HERE .
C(40). Hungry? Go HERE .
D(67). To hear from your Dr. Horrible co-star, Nathan Fillion, go HERE .

67. And now a word from your friend ...
A(90). To watch the Emmys from a different perspective, go HERE .
B(30). To hear from Joss Whedon, go HERE .
C(3). To win your first major competition, report HERE . Bring a pressed suit, your cutest smile, and a $25 entry fee.

68. In the middle of your run in How I Met Your Mother, you try to squeeze in one little piece of theater work: a limited-run staged reading of Sondheim's Comp...
A(93). If you want to reclaim your reputation in the Broadway community, go HERE .
B(66). If you feel horrible about what's happened, so much so that you want the world to know you as Horrible, go HERE .
C(87). If you would rather cheer yourself up by spending a week at Sir Elton John's home in Nice, go HERE .

69. As you get older you notice a surprising number of contemporaries who, when introduced to friends' children, demonstrate indifference at best, feral suspic...
A(37). If you change your mind about having kids, go HERE .
B(70). If you're ready for a family, go HERE .

70. But alas, try and try as you might, you and David simply cannot get pregnant.
A(73). To see what could happen if the press knew you were trying to have children, go HERE .
B(71). To continue the story, go HERE .

71. So now all that precaution and security seem to have been for naught. You're back to square one, older and wiser and sadder, the guest bedroom still its ne...
A(51). If reading that last line made you think about Barney Stinson and you're suddenly anxious to hear from him, go HERE .
B(72). But you should probably stick around and go HERE . It's about to get really exciting.

72. Phone call! They take!
A(94). To further bask in the awesomeness of Gideon and Harper, go HERE .
B(76). To watch Bret Michaels of Poison get whacked upside the head, go HERE .

73. A cordon of police cars follow behind you. Ahead, a highway overpass rapidly fills with people waving and holding posters like STAY STRONG, BARNEY and RUN, N...
A(73). End.

75. Fundamentally interwoven in your genetic makeup is the ability and desire to play the role of Kermit the Frog or P. T. Barnum, the impresario, the circus ri...
A(76). If you would like to host the 2009 Tonys and watch a hair-metal hero almost die of blunt force trauma, go HERE .
B(81). If you would like to host the 2011 Tonys and sing a legen, wait for it, dary opening song called "Broadway Is Not Just for Gays Anymore," go HERE .
C(84). If you would like to host the 2013 Tonys and pull off an extraordinary theatrical coup involving 121 actors in which you literally jump through a hoop and then disappear from the stage to reappear in the middle of the audience five seconds later, HERE .
D(90). If you would like to host the 2013 Emmys and wrangle together a half-dozen other awards-show hosts to perform with you in an evening whose overall theme turns out to be the icy hand of death, go HERE .

76. It's the 2009 Tony Awards and you are over the moon. It's your first time presiding over one of the four "major" awards shows. You're on a mission....
A(81). If you'd like to host the Tonys again, go HERE .
B(89). If you'd like to be hosted by Katy Perry, go HERE .

77. The NPH Show interviews Neil about talk-show appearances.
A(79). If you want to read the rest of your interview with yourself, go HERE .
B(78). If you want to hear from a close friend of Howard's (and yours), go HERE .
C(54). If you've had enough of this meta-self-indulgence and would like to mix yourself a drink, go HERE .

78. And now a word from your friend ...
A(79). Finish the interview about talk-show appearances.
B(58). Hang out with other magic types.

79. YOU: We're back to The NPH Show. I'm here with Neil Patrick Harris, or "NPH," as his fans call him.
A(48). To flip the channel and find yourself on How I Met Your Mother, go HERE .
B(75). To flip the channel and find yourself hosting an awards show, go HERE .
C(33). To flip the channel and find yourself in one of a dozen made-for-TV movies, go HERE .

80. And now, one more magic trick from Mr. Neil Patrick Harris.
A(48). Sorry. The magic show is over. Please exit through the rear doors and emerge HERE .
B(77). Although if you're still interested in doing more magic as Neil Patrick Harris, only this time on talk shows, feel free to take the secret exit leading HERE .

81. In 2011 Glenn and Ricky bring you back to host the Tonys for the second time. The ceremony is being held at the Beacon Theatre because a new Cirque du Soleil...
A(84). If you'd like to host the Tonys a third and fourth time, go HERE .
B(29). If sodomy genuinely is required, go HERE .

82. And now a word from your friend ...
A(68). To do damage to a different kind of company, go HERE .
B(92). To hear from one of your costars in Seth MacFarlane's film A Million Ways to Die in the West, go HERE .

83. You have a very healthy inner child, and for many years it's been asking your outer adult to get more work in kids' entertainment. But your outer adult n...
A(94). To innocently hang out with your kids, go HERE .
B(29). To not-so-innocently feel up an acrobat that time in Berlin, go HERE .
C(42). To hear from Amy Sedaris, a friend you made on the set of the movie The Best and the Brightest, a small independent film that is otherwise not mentioned anywhere in this book, go HERE .

84. After hosting the Tonys again in 2012, the producers ask you back the next year for a fourth (but hopefully not final) time. The show is moving back to Radio...
A(90). To host the Emmys later this same year, go HERE .
B(82). To hear from the man who hosted the Oscars earlier this same year, go HERE .

85. Sesame Street is one of the greatest and most satisfying experiences of your professional life. So when Big Bird calls you out of the blue to say he wants to...
A(85). End.

87. It's a typical day. After a quick jaunt on the jetty boat to the restaurant overlooking St. Tropez, where you and a dozen beautiful young people savor a l...
A(88). To tweet about how awesome Sir Elton John is, go HERE .
B(7). To live a life in which you never meet Sir Elton John, go HERE .

88. Tweets and social-media anecdotes.
A(96). Go HERE .
B(84). Unless you prefer to go HERE .

89. It's the night before Super Bowl XLVI (spoiler alert: Giants 21, Patriots 17), and you are in the host city of Indianapolis, attending something officially...
A(96). For a 100 percent gay-friendly vacation, go HERE .
B(81). For a 100 percent straight-friendly musical number, go HERE .

90. In 2009 you host the Emmys for the first time to widely favorable reviews. You have solid jokes, a wickedly witty and on-point opening number courtesy of you...
A(84). To pull off one of the more extraordinary musical numbers ever on live TV, go HERE .
B(91). To continue hosting Emmys, go HERE .

91. A few months earlier you'd opened the Tonys with "Bigger," one of the more extraordinary musical numbers ever pulled off on live TV. You don't want t...
A(66). To spend more time with Nathan Fillion, go HERE .
B(87). To spend more time with Sir Elton John, go HERE .

92. And now a word from your friend ...
A(90). To appear in a musical number with Sarah, go HERE .

93. Everything you've learned and achieved as an actor, performer, entertainer, and host culminates in 2014 when you play the title role in the Broadway reviva...
A(97). You're ready for your closing number. Go HERE .

94. Your four-year-old twins, Gideon and Harper, share a number of relatively unusual characteristics. For example, they are the best kids in the whole wide worl...
A(96). To take your kids on a fun trip to Disney World, go HERE .
B(97). For a happy ending, go HERE . A real happy ending. Not a metaphorical "happy ending," sicko.
C(29). Although if you want that, that's back HERE .

95. You are, like, crazy loved.
A(95). End.

96. You're on the Peter Pan's Flight ride at Disney World. You are forty years old going on five. Wheeeeeeeeeeee!
A(97). Go HERE .

97. Final musical happy ending.
A(1). To live your life again, go HERE .

98. Closing thanks and acknowledgments.
A(98). End.`;
const DEFAULT_PATHS = "";
const CHOICE_PRESETS = [
  {
    id: "nph-autobiography",
    label: "Neil Patrick Harris",
    description: "Choose Your Own Autobiography",
    choices: DEFAULT_CHOICES,
    paths: DEFAULT_PATHS,
  },
];
const PATH_COLORS = [
  "oklch(0.58 0.17 259)",
  "oklch(0.62 0.18 11)",
  "oklch(0.64 0.14 166)",
  "oklch(0.72 0.15 72)",
  "oklch(0.6 0.16 326)",
  "oklch(0.55 0.15 220)",
  "oklch(0.68 0.16 37)",
  "oklch(0.7 0.14 142)",
];
const EVENT_LINE_RE = /^(\d+)\.\s*(.*)$/;
const CHOICE_LINE_RE = /^([A-Z])\((\d+)\)\.\s*(.*)$/;
const INPUT_SETTLE_MS = 120;
const MAX_PARSE_ERRORS = 40;
const NODE_WIDTH = 220;
const NODE_TEXT_LINE_HEIGHT = 18;
const EVENT_BASE_HEIGHT = 88;
const ENDING_BASE_HEIGHT = 72;
const MAX_NODE_PREVIEW_LINES = 3;
const URL_PRESET_PARAM = "preset";
const URL_PATHS_PARAM = "paths";

function getPresetById(id) {
  return CHOICE_PRESETS.find((entry) => entry.id === id) ?? null;
}

function getInitialViewerState() {
  const fallbackPreset = CHOICE_PRESETS[0];

  if (typeof window === "undefined") {
    return {
      presetPickerId: fallbackPreset.id,
      activePresetId: fallbackPreset.id,
      choices: fallbackPreset.choices,
      paths: fallbackPreset.paths,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const preset = getPresetById(params.get(URL_PRESET_PARAM)) ?? fallbackPreset;

  return {
    presetPickerId: preset.id,
    activePresetId: preset.id,
    choices: preset.choices,
    paths: params.get(URL_PATHS_PARAM) ?? preset.paths,
  };
}

function createEvent(id, title, choices, lineNumber) {
  const choiceMap = Object.create(null);

  for (const choice of choices) {
    choiceMap[choice.marker] = choice;
  }

  return { id, title, choices, choiceMap, lineNumber };
}

function finishChoiceParse(events, firstEventId, errors) {
  if (events.size === 0) {
    errors.push("No events found. Add at least one event and one choice.");
  }

  return {
    ok: errors.length === 0,
    errors,
    graph: {
      events,
      rootId: events.has(1) ? 1 : firstEventId,
    },
  };
}

function pushParseError(errors, message) {
  if (errors.length < MAX_PARSE_ERRORS) {
    errors.push(message);
    return false;
  }

  if (errors.length === MAX_PARSE_ERRORS) {
    errors.push(
      `Too many parse errors. Showing the first ${MAX_PARSE_ERRORS}.`,
    );
  }

  return true;
}

function parseChoiceDsl(sourceText) {
  const lines = sourceText.replace(/\r/g, "").split("\n");
  const events = new Map();
  const errors = [];
  let lineIndex = 0;
  let firstEventId = null;

  while (lineIndex < lines.length) {
    const rawLine = lines[lineIndex].trim();
    if (!rawLine) {
      lineIndex += 1;
      continue;
    }

    const eventMatch = rawLine.match(EVENT_LINE_RE);
    if (!eventMatch) {
      if (
        pushParseError(
          errors,
          `Line ${lineIndex + 1}: expected an event like "17. SCHOOL BUS".`,
        )
      ) {
        return finishChoiceParse(events, firstEventId, errors);
      }
      lineIndex += 1;
      continue;
    }

    const eventId = Number(eventMatch[1]);
    const title = eventMatch[2].trim();
    if (events.has(eventId)) {
      if (
        pushParseError(
          errors,
          `Line ${lineIndex + 1}: event ${eventId} is defined more than once.`,
        )
      ) {
        return finishChoiceParse(events, firstEventId, errors);
      }
    }

    if (firstEventId === null) firstEventId = eventId;
    lineIndex += 1;

    const choices = [];
    const seenMarkers = new Set();

    while (lineIndex < lines.length) {
      const choiceLine = lines[lineIndex].trim();
      if (!choiceLine) {
        lineIndex += 1;
        break;
      }
      if (EVENT_LINE_RE.test(choiceLine)) break;

      const choiceMatch = choiceLine.match(CHOICE_LINE_RE);
      if (!choiceMatch) {
        if (
          pushParseError(
            errors,
            `Line ${lineIndex + 1}: expected a choice like "A(38). Go to art".`,
          )
        ) {
          return finishChoiceParse(events, firstEventId, errors);
        }
        lineIndex += 1;
        continue;
      }

      const marker = choiceMatch[1];
      const targetId = Number(choiceMatch[2]);
      const text = choiceMatch[3].trim();

      if (seenMarkers.has(marker)) {
        if (
          pushParseError(
            errors,
            `Line ${lineIndex + 1}: event ${eventId} repeats choice ${marker}.`,
          )
        ) {
          return finishChoiceParse(events, firstEventId, errors);
        }
      }
      seenMarkers.add(marker);

      choices.push({
        marker,
        targetId,
        text,
        lineNumber: lineIndex + 1,
      });
      lineIndex += 1;
    }

    if (choices.length === 0) {
      if (
        pushParseError(
          errors,
          `Line ${lineIndex}: event ${eventId} must have at least one choice.`,
        )
      ) {
        return finishChoiceParse(events, firstEventId, errors);
      }
    }

    if (!events.has(eventId)) {
      events.set(eventId, createEvent(eventId, title, choices, lineIndex + 1));
    }
  }

  return finishChoiceParse(events, firstEventId, errors);
}

function edgeKey(fromId, toId, marker) {
  return `${fromId}:${marker}:${toId}`;
}

function parsePathInputs(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw, index) => ({ raw, normalized: raw.toUpperCase(), index }));
}

function tracePath(graph, pathInput) {
  const { events, rootId } = graph;
  const invalidMatch = pathInput.normalized.match(/[^A-Z]/);

  if (rootId === null) {
    return {
      ...pathInput,
      status: "invalid",
      message: "No root event available.",
      nodeIds: [],
      edgeKeys: [],
      finalId: null,
    };
  }

  if (invalidMatch) {
    return {
      ...pathInput,
      status: "invalid",
      message: `Contains invalid character "${invalidMatch[0]}". Use letters only.`,
      nodeIds: [rootId],
      edgeKeys: [],
      finalId: rootId,
    };
  }

  let currentId = rootId;
  const nodeIds = [currentId];
  const edgeKeys = [];

  for (
    let stepIndex = 0;
    stepIndex < pathInput.normalized.length;
    stepIndex += 1
  ) {
    const marker = pathInput.normalized[stepIndex];
    const event = events.get(currentId);

    if (!event) {
      return {
        ...pathInput,
        status: "invalid",
        message: `Step ${stepIndex + 1}: path continues after ending ${currentId}.`,
        nodeIds,
        edgeKeys,
        finalId: currentId,
      };
    }

    const choice = event.choiceMap[marker];
    if (!choice) {
      return {
        ...pathInput,
        status: "invalid",
        message: `Step ${stepIndex + 1}: event ${currentId} has no ${marker} choice.`,
        nodeIds,
        edgeKeys,
        finalId: currentId,
      };
    }

    edgeKeys.push(edgeKey(currentId, choice.targetId, choice.marker));
    currentId = choice.targetId;
    nodeIds.push(currentId);
  }

  if (events.has(currentId)) {
    return {
      ...pathInput,
      status: "in-progress",
      message: `Stops at event ${currentId} before reaching an ending.`,
      nodeIds,
      edgeKeys,
      finalId: currentId,
    };
  }

  return {
    ...pathInput,
    status: "ending",
    message: `Reached ending ${currentId}.`,
    nodeIds,
    edgeKeys,
    finalId: currentId,
  };
}

function summarizeTraces(graph, traces) {
  const edgeCounts = new Map();
  const nodeCounts = new Map();
  const endingCounts = new Map();
  let invalidCount = 0;
  let inProgressCount = 0;
  let endingCount = 0;

  for (const trace of traces) {
    if (trace.status === "invalid") invalidCount += 1;
    if (trace.status === "in-progress") inProgressCount += 1;
    if (trace.status === "ending") endingCount += 1;

    for (const nodeId of trace.nodeIds) {
      nodeCounts.set(nodeId, (nodeCounts.get(nodeId) ?? 0) + 1);
    }

    for (const key of trace.edgeKeys) {
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }

    if (trace.status === "ending" && trace.finalId !== null) {
      endingCounts.set(
        trace.finalId,
        (endingCounts.get(trace.finalId) ?? 0) + 1,
      );
    }
  }

  let totalEdges = 0;
  const endingIds = new Set();
  for (const event of graph.events.values()) {
    totalEdges += event.choices.length;
    for (const choice of event.choices) {
      if (!graph.events.has(choice.targetId)) endingIds.add(choice.targetId);
    }
  }

  return {
    edgeCounts,
    nodeCounts,
    endingCounts,
    invalidCount,
    inProgressCount,
    endingCount,
    totalNodes: graph.events.size + endingIds.size,
    totalEdges,
  };
}

function wrapText(text, maxCharsPerLine) {
  if (!text) return [""];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines = [];
  let currentLine = words[0];

  for (let index = 1; index < words.length; index += 1) {
    const nextWord = words[index];
    if (`${currentLine} ${nextWord}`.length <= maxCharsPerLine) {
      currentLine += ` ${nextWord}`;
      continue;
    }

    lines.push(currentLine);
    currentLine = nextWord;
  }

  lines.push(currentLine);
  return lines;
}

function formatEventDetail(event) {
  return {
    kicker: `Event ${event.id}`,
    title: event.title || `Event ${event.id}`,
    body: null,
    choices: event.choices.map((choice) => ({
      marker: choice.marker,
      targetId: choice.targetId,
      text: choice.text,
    })),
  };
}

function formatEndingDetail(endingId) {
  return {
    kicker: `Ending ${endingId}`,
    title: `Ending ${endingId}`,
    body: "This node is an undefined target id referenced by a choice, so the viewer treats it as a terminal ending.",
    choices: [],
  };
}

function nodeHeightFromPreview(previewLineCount, isEnding) {
  const baseHeight = isEnding ? ENDING_BASE_HEIGHT : EVENT_BASE_HEIGHT;
  const minimumLineCount = isEnding ? 1 : 2;
  const extraLines = Math.max(0, previewLineCount - minimumLineCount);
  return baseHeight + extraLines * NODE_TEXT_LINE_HEIGHT;
}

function buildNodeModels(graph, summary) {
  const nodeModels = [];
  const baseEdges = [];
  const endingIds = new Set();

  for (const event of graph.events.values()) {
    const lines = wrapText(event.title || `Event ${event.id}`, 20);
    const previewLines = lines.slice(0, MAX_NODE_PREVIEW_LINES);
    const hasOverflow = lines.length > previewLines.length;
    const nodeCount = summary.nodeCounts.get(event.id) ?? 0;
    const endingCount = summary.endingCounts.get(event.id) ?? 0;

    nodeModels.push({
      id: String(event.id),
      nodeId: event.id,
      kind: "event",
      title: event.title || `Event ${event.id}`,
      previewLines,
      hasOverflow,
      detail: formatEventDetail(event),
      nodeCount,
      endingCount,
      width: NODE_WIDTH,
      height: nodeHeightFromPreview(previewLines.length, false),
    });

    for (const choice of event.choices) {
      const targetKey = String(choice.targetId);
      baseEdges.push({
        id: edgeKey(event.id, choice.targetId, choice.marker),
        source: String(event.id),
        target: targetKey,
        marker: choice.marker,
        text: choice.text,
      });
      if (!graph.events.has(choice.targetId)) endingIds.add(choice.targetId);
    }
  }

  for (const endingId of [...endingIds].sort((left, right) => left - right)) {
    const lines = wrapText(`Ending ${endingId}`, 18);
    const previewLines = lines.slice(0, MAX_NODE_PREVIEW_LINES);
    const nodeCount = summary.nodeCounts.get(endingId) ?? 0;
    const endingCount = summary.endingCounts.get(endingId) ?? 0;

    nodeModels.push({
      id: String(endingId),
      nodeId: endingId,
      kind: "ending",
      title: `Ending ${endingId}`,
      previewLines,
      hasOverflow: false,
      detail: formatEndingDetail(endingId),
      nodeCount,
      endingCount,
      width: NODE_WIDTH,
      height: nodeHeightFromPreview(previewLines.length, true),
    });
  }

  return { nodeModels, baseEdges };
}

async function buildLayout(graph, traces, summary) {
  const { nodeModels, baseEdges } = buildNodeModels(graph, summary);
  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.padding": "[left=40, top=36, right=40, bottom=36]",
      "elk.spacing.nodeNode": "42",
      "elk.layered.spacing.nodeNodeBetweenLayers": "112",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    },
    children: nodeModels.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
    })),
    edges: baseEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const layout = await elk.layout(elkGraph);
  const positionedNodes = new Map(
    (layout.children ?? []).map((child) => [child.id, child]),
  );
  const edgeCounts = summary.edgeCounts;
  const edgeById = new Map(baseEdges.map((edge) => [edge.id, edge]));

  const nodes = nodeModels.map((node) => {
    const positioned = positionedNodes.get(node.id);

    return {
      id: node.id,
      type: "gamebook",
      position: {
        x: positioned?.x ?? 0,
        y: positioned?.y ?? 0,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      draggable: false,
      selectable: false,
      data: node,
      style: {
        width: node.width,
      },
    };
  });

  const edges = baseEdges.map((edge) => {
    const edgeCount = edgeCounts.get(edge.id) ?? 0;

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      label: edge.marker,
      labelShowBg: true,
      labelBgPadding: [8, 4],
      labelStyle: { fill: "currentColor" },
      style: {
        stroke:
          edgeCount > 0 ? "rgb(110 110 120 / 0.42)" : "rgb(110 110 120 / 0.24)",
        strokeWidth: edgeCount > 0 ? 3 : 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color:
          edgeCount > 0 ? "rgb(110 110 120 / 0.42)" : "rgb(110 110 120 / 0.24)",
      },
      zIndex: 1,
      interactionWidth: 24,
    };
  });

  for (let traceIndex = 0; traceIndex < traces.length; traceIndex += 1) {
    const trace = traces[traceIndex];
    const color = PATH_COLORS[traceIndex % PATH_COLORS.length];

    for (let keyIndex = 0; keyIndex < trace.edgeKeys.length; keyIndex += 1) {
      const key = trace.edgeKeys[keyIndex];
      const baseEdge = edgeById.get(key);
      if (!baseEdge) continue;

      edges.push({
        id: `trace-${traceIndex}-${keyIndex}-${key}`,
        source: baseEdge.source,
        target: baseEdge.target,
        type: "smoothstep",
        style: {
          stroke: color,
          strokeWidth: 4,
          opacity: trace.status === "invalid" ? 0.5 : 0.92,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
        },
        zIndex: 2,
        interactionWidth: 0,
      });
    }
  }

  return { nodes, edges };
}

function useDebouncedText(initialValue) {
  const [draft, setDraft] = useState(initialValue);
  const [settled, setSettled] = useState(initialValue);

  useEffect(() => {
    const timerId = window.setTimeout(() => setSettled(draft), INPUT_SETTLE_MS);
    return () => window.clearTimeout(timerId);
  }, [draft]);

  return {
    draft,
    setDraft,
    settled,
    flush: () => setSettled(draft),
    setValue: (value) => {
      setDraft(value);
      setSettled(value);
    },
  };
}

const GamebookNode = memo(function GamebookNode({ data }) {
  const openNode = () => data.onOpen(data.nodeId);

  return (
    <button
      type="button"
      className="gamebook-node"
      style={{
        "--node-fill":
          data.endingCount > 0 ?
            "color-mix(in oklch, var(--color-accent) 14%, white)"
          : data.nodeCount > 0 ?
            "color-mix(in oklch, var(--color-accent) 6%, white)"
          : data.kind === "ending" ? "oklch(0.97 0.012 245)"
          : "rgb(255 255 255 / 0.96)",
        "--node-stroke":
          data.endingCount > 0 ?
            "color-mix(in oklch, var(--color-accent) 52%, white)"
          : data.nodeCount > 0 ?
            "color-mix(in oklch, var(--color-accent) 30%, white)"
          : "rgb(84 84 94 / 0.24)",
        "--node-radius": data.kind === "ending" ? "24px" : "16px",
      }}
      onClick={openNode}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openNode();
        }
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="gamebook-handle"
      />
      <div className="gamebook-node__eyebrow">
        {data.kind === "ending" ? "ENDING" : "EVENT"} {data.nodeId}
      </div>
      {data.nodeCount > 0 ?
        <div className="gamebook-node__count">
          {data.nodeCount} path{data.nodeCount === 1 ? "" : "s"}
        </div>
      : null}
      <div className="gamebook-node__title">
        {data.previewLines.map((line, index) => (
          <span
            key={`${data.nodeId}-${index}`}
            className="gamebook-node__title-line"
          >
            {line}
          </span>
        ))}
      </div>
      {data.hasOverflow ?
        <span className="gamebook-node__badge gamebook-node__badge--more">
          +
        </span>
      : null}
      {data.endingCount > 0 ?
        <span className="gamebook-node__badge gamebook-node__badge--ending">
          {data.endingCount} hit{data.endingCount === 1 ? "" : "s"}
        </span>
      : null}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="gamebook-handle"
      />
    </button>
  );
});

const nodeTypes = {
  gamebook: GamebookNode,
};

function NodeModal({ node, onClose }) {
  return (
    <div
      className="gamebook-modal-backdrop"
      onClick={onClose}
    >
      <section
        className="gamebook-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gamebook-node-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="gamebook-modal-head">
          <div>
            <div className="gamebook-modal-kicker">{node.detail.kicker}</div>
            <h3
              id="gamebook-node-modal-title"
              className="gamebook-modal-title"
            >
              {node.detail.title}
            </h3>
          </div>
          <button
            type="button"
            className="gamebook-modal-close"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {node.detail.body ?
          <section className="gamebook-modal-section">
            <p className="gamebook-modal-copy">{node.detail.body}</p>
          </section>
        : null}

        {node.detail.choices.length > 0 ?
          <section className="gamebook-modal-section">
            <h4 className="gamebook-section-title">Choices</h4>
            <ol className="gamebook-modal-list">
              {node.detail.choices.map((choice) => (
                <li key={`${node.nodeId}-${choice.marker}`}>
                  <code>
                    {choice.marker}({choice.targetId})
                  </code>
                  . {choice.text}
                </li>
              ))}
            </ol>
          </section>
        : null}
      </section>
    </div>
  );
}

export default function GamebookViewer() {
  const [initialState] = useState(() => getInitialViewerState());
  const choices = useDebouncedText(initialState.choices);
  const paths = useDebouncedText(initialState.paths);
  const [presetPickerId, setPresetPickerId] = useState(
    initialState.presetPickerId,
  );
  const [activePresetId, setActivePresetId] = useState(
    initialState.activePresetId,
  );
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [flowState, setFlowState] = useState({ nodes: [], edges: [] });
  const [isLayingOut, setIsLayingOut] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const flowShellRef = useRef(null);

  const loadPreset = (nextPresetId) => {
    const preset = getPresetById(nextPresetId);
    if (!preset) return;

    setPresetPickerId(preset.id);
    setActivePresetId(preset.id);
    choices.setValue(preset.choices);
    paths.setValue(preset.paths);
    setSelectedNodeId(null);
  };

  const parsed = useMemo(
    () => parseChoiceDsl(choices.settled),
    [choices.settled],
  );
  const pathInputs = useMemo(
    () => parsePathInputs(paths.settled),
    [paths.settled],
  );
  const traces = useMemo(
    () =>
      parsed.ok ?
        pathInputs.map((entry) => tracePath(parsed.graph, entry))
      : [],
    [parsed, pathInputs],
  );
  const summary = useMemo(
    () => (parsed.ok ? summarizeTraces(parsed.graph, traces) : null),
    [parsed, traces],
  );

  useEffect(() => {
    if (selectedNodeId === null) return undefined;

    const handleKeydown = (event) => {
      if (event.key === "Escape") setSelectedNodeId(null);
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [selectedNodeId]);

  useEffect(() => {
    const matchingPreset =
      CHOICE_PRESETS.find((preset) => preset.choices === choices.settled)
      ?? null;
    setActivePresetId(matchingPreset?.id ?? null);
  }, [choices.settled]);

  useEffect(() => {
    const url = new URL(window.location.href);

    if (activePresetId) url.searchParams.set(URL_PRESET_PARAM, activePresetId);
    else url.searchParams.delete(URL_PRESET_PARAM);

    if (paths.settled) url.searchParams.set(URL_PATHS_PARAM, paths.settled);
    else url.searchParams.delete(URL_PATHS_PARAM);

    if (url.toString() !== window.location.href) {
      window.history.replaceState(null, "", url);
    }
  }, [activePresetId, paths.settled]);

  useEffect(() => {
    if (!parsed.ok || !summary) {
      setFlowState({ nodes: [], edges: [] });
      return undefined;
    }

    let isCancelled = false;
    setIsLayingOut(true);

    buildLayout(parsed.graph, traces, summary)
      .then((nextFlowState) => {
        if (!isCancelled) setFlowState(nextFlowState);
      })
      .finally(() => {
        if (!isCancelled) setIsLayingOut(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [parsed, summary, traces]);

  const nodes = useMemo(
    () =>
      flowState.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onOpen: setSelectedNodeId,
        },
      })),
    [flowState.nodes],
  );

  const selectedNode = useMemo(
    () =>
      nodes.find((node) => Number(node.id) === selectedNodeId)?.data ?? null,
    [nodes, selectedNodeId],
  );

  const handleExportPng = async () => {
    if (flowState.nodes.length === 0 || !flowShellRef.current) return;

    const viewport = flowShellRef.current.querySelector(
      ".react-flow__viewport",
    );
    if (!(viewport instanceof HTMLElement)) {
      setExportError("Couldn't find the rendered map to export.");
      return;
    }

    setIsExporting(true);
    setExportError("");

    try {
      const bounds = getNodesBounds(flowState.nodes);
      const exportWidth = Math.max(Math.ceil(bounds.width), 1200);
      const exportHeight = Math.max(Math.ceil(bounds.height), 800);
      const viewportTransform = getViewportForBounds(
        bounds,
        exportWidth,
        exportHeight,
        0.1,
        1.5,
        0.12,
      );
      const dataUrl = await toPng(viewport, {
        backgroundColor: "#fdf6e3",
        cacheBust: true,
        pixelRatio: 2,
        width: exportWidth,
        height: exportHeight,
        style: {
          width: `${exportWidth}px`,
          height: `${exportHeight}px`,
          transform: `translate(${viewportTransform.x}px, ${viewportTransform.y}px) scale(${viewportTransform.zoom})`,
          transformOrigin: "top left",
        },
      });
      const link = document.createElement("a");

      link.download = `${activePresetId ?? "custom"}-map.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      setExportError("PNG export failed. Try again after the layout finishes.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="gamebook-viewer">
      <section className="gamebook-panel gamebook-controls">
        <div className="gamebook-controls-grid">
          <section>
            <h2 className="gamebook-section-title">Choices</h2>
            <p className="gamebook-section-copy">
              Each event starts with <code>number. title</code>, followed by one
              or more choices like <code>A(27). description</code>.
            </p>
            <div className="gamebook-preset-row">
              <label className="gamebook-preset-picker">
                <span className="gamebook-field-label-text">Preset</span>
                <select
                  className="gamebook-select"
                  value={presetPickerId}
                  onChange={(event) =>
                    setPresetPickerId(event.currentTarget.value)
                  }
                >
                  {CHOICE_PRESETS.map((preset) => (
                    <option
                      key={preset.id}
                      value={preset.id}
                    >
                      {preset.label} - {preset.description}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="gamebook-button"
                onClick={() => loadPreset(presetPickerId)}
              >
                Load preset
              </button>
            </div>
            <div className="gamebook-mini-example">
              1. You, Neil Patrick Harris, are born in Albuquerque, New Mexico,
              on June 15, 1973... A(3). If you would like to experience a happy
              childhood, go HERE . B(2). If you would prefer a miserable
              childhood, go HERE .
            </div>
            <label
              htmlFor="choices"
              className="gamebook-field-label"
            >
              <span>Choice DSL</span>
              <span className="gamebook-field-hint">
                Neil Patrick Harris preloaded
              </span>
            </label>
            <textarea
              id="choices"
              className="gamebook-textarea"
              spellCheck={false}
              value={choices.draft}
              onInput={(event) => choices.setDraft(event.currentTarget.value)}
              onBlur={choices.flush}
            />
          </section>

          <section>
            <h2 className="gamebook-section-title">Paths</h2>
            <p className="gamebook-section-copy">
              One path per line. Letters are followed from the root event.
              Completed paths count toward the endings they reach.
            </p>
            <label
              htmlFor="paths"
              className="gamebook-field-label"
            >
              <span>Path Inputs</span>
              <span className="gamebook-field-hint">Example: ABAACAAA</span>
            </label>
            <textarea
              id="paths"
              className="gamebook-textarea gamebook-textarea--paths"
              spellCheck={false}
              value={paths.draft}
              onInput={(event) => paths.setDraft(event.currentTarget.value)}
              onBlur={paths.flush}
            />
          </section>
        </div>
      </section>

      <section className="gamebook-panel gamebook-canvas">
        <div className="gamebook-viewer-head">
          <div>
            <h2 className="gamebook-section-title">Path Diagram</h2>
            <p>
              Compare each recorded route against the full branching map. Tap or
              click any node to read the full passage, or press
              <kbd>Escape</kbd> to close it.
            </p>
          </div>
          <div className="gamebook-viewer-head-actions">
            <button
              type="button"
              className="gamebook-button"
              onClick={handleExportPng}
              disabled={
                isExporting || isLayingOut || flowState.nodes.length === 0
              }
            >
              {isExporting ? "Saving PNG..." : "Save map as PNG"}
            </button>
            {exportError ?
              <p
                className="gamebook-export-status"
                role="status"
              >
                {exportError}
              </p>
            : null}
          </div>
          {summary ?
            <div
              className="gamebook-summary-row"
              aria-label="Diagram summary"
            >
              <div className="gamebook-pill gamebook-pill--neutral">
                {summary.totalNodes} nodes
              </div>
              <div className="gamebook-pill gamebook-pill--neutral">
                {summary.totalEdges} choices
              </div>
              <div className="gamebook-pill gamebook-pill--accent">
                {summary.endingCount} endings reached
              </div>
              <div className="gamebook-pill gamebook-pill--soft">
                {summary.inProgressCount} still in progress
              </div>
              <div className="gamebook-pill gamebook-pill--warning">
                {summary.invalidCount} invalid
              </div>
            </div>
          : null}
        </div>

        {parsed.errors.length > 0 ?
          <div
            className="gamebook-error-block"
            role="alert"
          >
            <h3>DSL parse errors</h3>
            <ul className="gamebook-error-list">
              {parsed.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        : null}

        {traces.length > 0 ?
          <div
            className="gamebook-path-list"
            aria-label="Path outcomes"
          >
            {traces.map((trace, index) => {
              const color = PATH_COLORS[index % PATH_COLORS.length];
              return (
                <div
                  className="gamebook-path-pill"
                  key={`${trace.raw}-${index}`}
                >
                  <span className="gamebook-path-label">Path {index + 1}</span>
                  <span
                    className="gamebook-swatch"
                    style={{ background: color }}
                    aria-hidden="true"
                  />
                  <code>{trace.raw}</code>
                  <span className="gamebook-path-status">{trace.message}</span>
                </div>
              );
            })}
          </div>
        : null}

        <div
          className="gamebook-flow-shell"
          ref={flowShellRef}
        >
          {parsed.ok && summary ?
            <div className="gamebook-flow">
              {isLayingOut ?
                <div className="gamebook-flow-loading">Laying out graph...</div>
              : null}
              <ReactFlow
                nodes={nodes}
                edges={flowState.edges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.16 }}
                minZoom={0.1}
                maxZoom={1.5}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag
                zoomOnDoubleClick={false}
                proOptions={{ hideAttribution: true }}
              >
                <MiniMap
                  pannable
                  zoomable
                />
                <Controls showInteractive={false} />
                <Background
                  color="rgb(84 84 94 / 0.14)"
                  gap={20}
                />
              </ReactFlow>
            </div>
          : <div className="gamebook-flow-empty">
              Enter a valid DSL to render the diagram.
            </div>
          }
        </div>

        <p className="gamebook-legend-note">
          Undefined target ids are treated as endings. Paths that stop on a
          defined event are marked in progress. Paths that request a missing
          letter or continue past an ending are marked invalid.
        </p>
      </section>

      {selectedNode ?
        <NodeModal
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
        />
      : null}
    </div>
  );
}
