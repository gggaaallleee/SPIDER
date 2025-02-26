import { URL } from 'url';
import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer';
import { setupPage } from '../utils/setupPage';
import { Cluster } from 'puppeteer-cluster';

async function randomWait(min: number, max: number) {
    // 随机等待时间
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

export const fetchSearchResults = async (query: string, pageCount: number, searchUrlBase: string) => {
    console.log(`Fetching Baidu search results for query: ${query}`);
    // 如果 searchUrlBase 为空，返回空数组
    if (!searchUrlBase) {
        return { resultUrls: [], results: new Map() };
    }
    const resultUrls: string[] = [];
    const results = new Map<string, any>();

    const pagesToFetch = Math.ceil(pageCount / 10);

    const browser = await puppeteer.launch({headless: true, pipe: true});

    const page = await browser.newPage();
    await setupPage(page);

    for (let i = 0; i < pagesToFetch; i++) {
        const searchUrl = new URL(`${searchUrlBase}?wd=${encodeURIComponent(query)}&pn=${i * 10}`);
        console.log(`Fetching page ${i + 1} from Baidu: ${searchUrl.toString()}`);
        let retryCount = 0;
        let success = false;

        while (retryCount < 10 && !success) {
            try {
                console.time(`Page Load Time for page ${i + 1}`);
                await page.goto(searchUrl.toString(), { waitUntil: 'load' });
                console.timeEnd(`Page Load Time for page ${i + 1}`);

                let content = await page.content();
                let dom = new JSDOM(content);
                let document = dom.window.document;
                console.log(document.title);

                // 如果是百度安全验证页面，重新设置页面并重新访问
                if (document.title.includes('百度安全验证')) {
                    console.log('Detected Baidu security verification, retrying...');
                    await setupPage(page);
                    retryCount++;
                    //随机等待时间
                    await randomWait(1000, 3000);
                    continue;
                }

                // 解析搜索结果
                console.time(`Link Retrieval Time for page ${i + 1}`);
                const resultContainers = document.querySelectorAll('.result.c-container');
                for (const result of resultContainers) {
                    if (resultUrls.length > pageCount + 5) {
                        break;
                    }
                    const titleElement = result.querySelector('h3 a');
                    const title = titleElement ? titleElement.textContent : '';
                    const url = titleElement ? titleElement.getAttribute('href') : '';
                    const contentElement = result.querySelector('[class^="content"]');
                    const content = contentElement ? contentElement.textContent : '';

                    if (url) {
                        resultUrls.push(url);
                        results.set(url, {
                            title,
                            url,
                            snippet: content,
                            source: 'baidu',
                            crawlStatus: 'Pending',
                            score: 0 
                        });
                    }
                }
                console.timeEnd(`Link Retrieval Time for page ${i + 1}`);
                success = true;
            } catch (error) {
                console.error(`Error fetching page ${i + 1}:`, error);
                retryCount++;
            }
        }
    }

    await browser.close();

    // 并发处理真实 URL
    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 10,
        puppeteerOptions: { ignoreDefaultArgs: ["--enable-automation"], headless: true, pipe: true }
    });

    let failedUrlCount = 0;

    await cluster.task(async ({ page, data: url }) => {
        let retryUrlCount = 0;
        let urlSuccess = false;
        while (retryUrlCount < 3 && !urlSuccess) {
            try {
                await page.goto(url, { waitUntil: 'load' });
                // 检查页面是否被分离
                if (page.isClosed()) {
                    throw new Error('Page has been closed');
                }
                const realUrl = page.url(); // 获取真实 URL
                const result = results.get(url);
                if (result) {
                    result.url = realUrl;
                    result.crawlStatus = 'Success';
                }
                urlSuccess = true;
            } catch (error) {
                console.error(`Error fetching original URL, retrying...`, error);
                retryUrlCount++;
                await randomWait(1000, 3000);
            }
        }
        if (!urlSuccess) {
            failedUrlCount++;
        }
    });

    for (const url of resultUrls) {
        cluster.queue(url);
    }

    await cluster.idle();
    await cluster.close();

    console.log(`Number of URLs that failed to return a real URL: ${failedUrlCount}`);

    // 过滤并返回前 pageCount 个结果
    const filteredResults = Array.from(results.values()).slice(0, pageCount);

    return { resultUrls: filteredResults.map(result => result.url), results: new Map(filteredResults.map(result => [result.url, result])) };
};