// load modules
const express = require('express');
const handlebars = require('express-handlebars');
const mysql = require('mysql2/promise');
const fetch = require('node-fetch');
const withQuery = require('with-query').default;
const morgan = require('morgan');

// configure port
const PORT = parseInt(process.argv[2]) || process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';

// sql statement
const SQL_LIMIT = 10;
const SQL_GET_BOOKS_BY_LETTER = 'select book_id, title from book2018 where title like ? order by title limit ? offset ?';
const SQL_TOTAL_BOOKS_BY_LETTER = 'select count(*) as total from book2018 where title like ?';
const SQL_GET_BOOK_BY_ID = 'select * from book2018 where book_id = ?';

// create connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'goodreads',
    connectionLimit: 4,
    timezone: '+08:00'
});

// create an instance of express
const app = express();

// configure hbs
app.engine('hbs', handlebars({ defaultLayout: 'default.hbs' }));
app.set('view engine', 'hbs');

// configure app

// logging
app.use(morgan('combined'));

// landing page
app.get(['/', 'index.html'], (req, res) => {
    res.status(200);
    res.type('text/html');
    res.render('index');
});

// get book list by letter
app.get('/search/:letter', async(req,res) => {
    const letter = req.params.letter;
    const offset = req.query.offset || 0;

    const conn = await pool.getConnection();

    try {
        const [ result, _ ] = await conn.query(SQL_TOTAL_BOOKS_BY_LETTER, [ `${letter}%`]);
        const numOfBooks = result[0].total;

        let books;
        
        if(numOfBooks > 0) {
            const maxPage = Math.floor((numOfBooks / SQL_LIMIT) - 0.01) + 1;
            // console.log('>>> maxPage: ', maxPage);

            [ books, __ ] = await conn.query(SQL_GET_BOOKS_BY_LETTER, [ `${letter}%`, SQL_LIMIT, offset]);
            
        } 

        res.status(200);
        res.type('text/html');
        res.render('list', { 
            letter: letter.toUpperCase(),
            hasContent: !!numOfBooks,
            books
        });
    } catch(e) {
        res.status(500);
        res.type('text/html');
        res.send(JSON.stringify(e));
    } finally {
        conn.release();
    }
});

// get single book's details
app.get('/book/:id', async(req, res) => {
    const id = req.params.id;

    const conn = await pool.getConnection();

    try {
        const [ book, _ ] = await conn.query(SQL_GET_BOOK_BY_ID, [ id ]);
        let authors;
        let genres;

        if(book.length > 0) {
             authors = book[0].authors.replace(/\|/g, ', ');
             genres = book[0].genres.replace(/\|/g, ', ');
            // console.log('>>> genres: ', genres);
        }

        res.status(200);
        res.format({
            'text/html': () => {
                res.type('text/html');
                res.render('book', {
                    hasContent: !!book.length,
                    book: book[0],
                    authors,
                    genres
                });
            },
            'application/json': () => {
                if(book.length > 0) {
                    res.type('application/json');
                    res.json({
                        bookId: book[0].book_id,
                        title: book[0].title,
                        authors: book[0].authors,
                        summary: book[0].description,
                        pages: book[0].pages,
                        rating: book[0].rating,
                        ratingCount: book[0].rating_count,
                        genre: book[0].genres
                    });
                } else {
                    res.type('application/json');
                    res.json({
                        '404 Not Found': 'Sorry! No info found for the requested book id.'
                    });
                }
            },
            'default': () => {
                res.type('text/plain');
                res.send(`Sorry! The requested data type is not supported by the endpoint.`);
            }
        });
    } catch(e) {
        res.status(500);
        res.type('text/html');
        res.send(`Error: ${JSON.stringify(e)}`);
    } finally {
        conn.release();
    }
});

// get reviews from NYT API
app.get('/review', async(req, res) => {
    const title = req.query.title || '';
    const author = req.query.author.replace(/,/g, ' and') || '';

    // console.log('>>> title: ', title);
    // console.log('>>> author: ', author);

    const URL = 'https://api.nytimes.com/svc/books/v3/reviews.json';
    const endpoint = withQuery(URL, {
        title,
        author,
        'api-key': API_KEY
    });
    // console.log('>>> endpoint: ', endpoint);
    
    try {
        const result = await fetch(endpoint);
        const data = await result.json();
        // console.log('>>> fetch results: ', data);

        const reviews = data.results;

        res.status(200);
        res.type('text/html');
        res.render('review', {
            hasContent: !!reviews.length,
            reviews
        });
    } catch(e) {
        res.status(500);
        res.type('text/html');
        res.send(JSON.stringify(e));
    } 
});

// static resources
app.use(express.static(__dirname + '/static'));

// test db connection and start server
const startApp = async(app, pool) => {
    try {
        const conn = await pool.getConnection();
        console.info(`Pinging database...`);
        await conn.ping();
        conn.release();

        // start server
        app.listen(PORT, () => {
            console.info(`Application started on PORT ${PORT} at ${new Date()}`);
        });
    } catch(e) {
        console.error(`Failed to ping database: ${e}`);
    } 
};

// check if API_KEY exists in environment variable
if(API_KEY) {
    startApp(app, pool);
} else {
    console.error('Failed to start server: No API_KEY in environment variables.');
}